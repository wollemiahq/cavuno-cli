import { Command } from 'commander';

import { createOperationsClient } from '../api/operations.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';
import { waitForOperation } from '../lib/wait.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createOperationsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
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

export function registerOperationsCommand(root: Command): void {
  const operations = root
    .command('operations')
    .description('Poll and cancel async operations by ID.');

  annotate(
    operations
      .command('get')
      .description('Fetch a single operation by ID.')
      .argument('<id>', 'Operation ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.get(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/operations/:id',
      examples: ['cavuno operations get op_123'],
    },
  );

  annotate(
    operations
      .command('cancel')
      .description('Request cancellation of an operation.')
      .argument('<id>', 'Operation ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.cancel(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/operations/:id/cancel',
      examples: ['cavuno operations cancel op_123'],
    },
  );

  annotate(
    operations
      .command('wait')
      .description(
        'Poll an operation until it reaches a terminal state (succeeded/failed/cancelled).',
      )
      .argument('<id>', 'Operation ID')
      .option(
        '--interval-ms <n>',
        'Poll interval in milliseconds (default 2000)',
        parseIntArg('--interval-ms', 100, 600_000),
      )
      .option(
        '--timeout-ms <n>',
        'Give up after this many milliseconds (default 3600000)',
        parseIntArg('--timeout-ms', 1000, 86_400_000),
      )
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ intervalMs?: number; timeoutMs?: number }>();
        await waitForOperation({
          client,
          id,
          format,
          intervalMs: opts.intervalMs,
          timeoutMs: opts.timeoutMs,
        });
      }),
    {
      mapsTo: 'GET /v1/operations/:id (poll)',
      examples: [
        'cavuno operations wait op_123',
        'cavuno operations wait op_123 --interval-ms 500 --timeout-ms 60000',
      ],
    },
  );
}
