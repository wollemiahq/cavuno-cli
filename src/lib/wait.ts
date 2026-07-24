import { createOperationsClient } from '../api/operations.js';

import { CliError, resolveAuth } from './auth.js';
import { fromApiError } from './error.js';
import { print, type OutputFormat } from './output.js';

import type { Command } from 'commander';

export interface WaitOptions {
  wait?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseIntArg(flag: string, min: number, max: number) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      console.error(`${flag}: expected an integer, got ${raw}`);
      process.exit(2);
    }
    if (n < min || n > max) {
      console.error(
        `${flag}: expected an integer from ${min} to ${max}, got ${raw}`,
      );
      process.exit(2);
    }
    return n;
  };
}

export function withWaitOption<T extends Command>(command: T): T {
  command
    .option(
      '--wait',
      'Poll the returned operation until it reaches a terminal state',
    )
    .option(
      '--interval-ms <n>',
      'Poll interval in milliseconds (default 2000)',
      parseIntArg('--interval-ms', 100, 600_000),
    )
    .option(
      '--timeout-ms <n>',
      'Give up after this many milliseconds (default 3600000)',
      parseIntArg('--timeout-ms', 1000, 86_400_000),
    );
  return command;
}

interface WaitClient {
  get(id: string): Promise<{
    data?: unknown;
    error?: unknown;
    response: { status: number; headers: Headers };
  }>;
}

export function operationsClientFrom(parent: Command): WaitClient {
  const opts = parent.optsWithGlobals<{ apiUrl?: string }>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createOperationsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

/**
 * Standard tail for async-initiator commands: with `--wait`, poll
 * the returned 202 operation to a terminal state and print that envelope;
 * without it, print the 202 envelope immediately.
 */
export async function printOrWait(
  parent: Command,
  r: { data?: unknown },
  opts: WaitOptions,
): Promise<void> {
  const format =
    parent.optsWithGlobals<{ format?: OutputFormat }>().format ?? 'json';
  if (opts.wait) {
    await waitForOperation({
      client: operationsClientFrom(parent),
      id: (r.data as { id: string }).id,
      format,
      intervalMs: opts.intervalMs,
      timeoutMs: opts.timeoutMs,
    });
    return;
  }
  print(r.data, format);
}

export async function waitForOperation(params: {
  client: WaitClient;
  id: string;
  format: OutputFormat;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<void> {
  const { client, id, format } = params;
  const intervalMs = params.intervalMs ?? 2000;
  const timeoutMs = params.timeoutMs ?? 3_600_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const r = await client.get(id);
    if (r.error) throw fromApiError(r.error, r.response);
    const op = r.data as { state?: string } | undefined;
    const state = op?.state;
    if (state && TERMINAL.has(state)) {
      print(r.data, format);
      if (state === 'succeeded') return;
      throw new CliError(`operation ended in state ${state}`, 7);
    }
    if (Date.now() >= deadline) {
      print(r.data, format);
      throw new CliError(
        `operation ${id} did not reach a terminal state within ${timeoutMs}ms`,
        11,
      );
    }
    await sleep(intervalMs);
  }
}
