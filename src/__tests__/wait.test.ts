import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

vi.mock('../api/operations.js', () => ({
  createOperationsClient: vi.fn(() => ({ get: vi.fn() })),
}));

import { waitForOperation, withWaitOption } from '../lib/wait.js';

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: new Response(null, { status: 200 }),
});

describe('withWaitOption', () => {
  it('adds --wait, --interval-ms, and --timeout-ms', () => {
    const command = withWaitOption(new Command('verify'));
    const longs = command.options.map((o) => o.long).sort();
    expect(longs).toEqual(['--interval-ms', '--timeout-ms', '--wait']);
  });
});

describe('waitForOperation', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('polls until a terminal succeeded state, then prints the envelope', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(ok({ id: 'op_1', state: 'running' }))
      .mockResolvedValueOnce(ok({ id: 'op_1', state: 'succeeded' }));

    await expect(
      waitForOperation({
        client: { get },
        id: 'op_1',
        format: 'json',
        intervalMs: 1,
        timeoutMs: 60_000,
      }),
    ).resolves.toBeUndefined();

    expect(get).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ id: 'op_1', state: 'succeeded' }, null, 2),
    );
  });

  it('throws exit 7 when the operation ends failed', async () => {
    const get = vi.fn().mockResolvedValue(ok({ id: 'op_1', state: 'failed' }));
    await expect(
      waitForOperation({
        client: { get },
        id: 'op_1',
        format: 'json',
        intervalMs: 1,
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject({ exitCode: 7 });
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ id: 'op_1', state: 'failed' }, null, 2),
    );
  });

  it('throws exit 11 when it does not reach a terminal state before the timeout', async () => {
    const get = vi.fn().mockResolvedValue(ok({ id: 'op_1', state: 'running' }));
    await expect(
      waitForOperation({
        client: { get },
        id: 'op_1',
        format: 'json',
        intervalMs: 1,
        timeoutMs: 0,
      }),
    ).rejects.toMatchObject({ exitCode: 11 });
  });
});
