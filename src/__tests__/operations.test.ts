import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGet, mockCancel } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockCancel: vi.fn(),
}));

vi.mock('../api/operations.js', () => ({
  createOperationsClient: vi.fn(() => ({
    get: mockGet,
    cancel: mockCancel,
  })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerOperationsCommand } from '../commands/operations.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function createProgram() {
  const program = new Command();
  program
    .exitOverride()
    .option('--api-url <url>')
    .option('--format <format>', 'Output format', 'json');
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerOperationsCommand(program);
  return program;
}

describe('operations CLI command registration', () => {
  let originalKey: string | undefined;
  let originalUrl: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    originalUrl = process.env.CAVUNO_API_URL;
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'http://localhost:3000/api/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
  });

  it('exposes get, cancel, and wait commands', () => {
    const program = createProgram();
    const ops = program.commands.find((c) => c.name() === 'operations');
    expect(ops).toBeDefined();
    const subcommands = ops!.commands.map((c) => c.name()).sort();
    expect(subcommands).toEqual(['cancel', 'get', 'wait']);
  });

  it('gets an operation', async () => {
    mockGet.mockResolvedValue({
      data: { id: 'op_1', state: 'running' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'operations', 'get', 'op_1'],
      { from: 'node' },
    );

    expect(mockGet).toHaveBeenCalledWith('op_1');
  });

  it('cancels an operation', async () => {
    mockCancel.mockResolvedValue({
      data: { id: 'op_1', cancelRequested: true },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'operations', 'cancel', 'op_1'],
      { from: 'node' },
    );

    expect(mockCancel).toHaveBeenCalledWith('op_1');
  });

  it('wait exits 0 when operation succeeds', async () => {
    mockGet.mockResolvedValue({
      data: { id: 'op_1', state: 'succeeded' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'operations',
        'wait',
        'op_1',
        '--interval-ms',
        '100',
        '--timeout-ms',
        '1000',
      ],
      { from: 'node' },
    );

    expect(mockGet).toHaveBeenCalledWith('op_1');
  });

  it('wait exits 7 when operation fails', async () => {
    mockGet.mockResolvedValue({
      data: { id: 'op_1', state: 'failed' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await expect(
      createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'operations',
          'wait',
          'op_1',
          '--interval-ms',
          '100',
          '--timeout-ms',
          '1000',
        ],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 7 });
  });

  it('maps operations_not_found to exit 4', async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'operations_not_found' } },
      response: new Response(null, { status: 404 }),
    });

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'operations', 'get', 'op_missing'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 4 });
  });
});
