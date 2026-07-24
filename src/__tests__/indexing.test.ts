import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetConfig, mockToggleIndexNow } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockToggleIndexNow: vi.fn(),
}));

vi.mock('../api/indexing.js', () => ({
  createIndexingClient: vi.fn(() => ({
    getConfig: mockGetConfig,
    toggleIndexNow: mockToggleIndexNow,
  })),
}));

import { registerIndexingCommand } from '../commands/indexing.js';

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
  registerIndexingCommand(program);
  return program;
}

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: new Response(null, { status: 200 }),
});

describe('indexing CLI command', () => {
  let originalKey: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'http://localhost:3000/api/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    logSpy.mockRestore();
  });

  it('registers the indexing subcommand surface', () => {
    const indexing = createProgram().commands.find(
      (c) => c.name() === 'indexing',
    );
    expect(indexing).toBeDefined();
    expect(indexing!.commands.map((c) => c.name()).sort()).toEqual([
      'config',
      'disable-indexnow',
      'enable-indexnow',
    ]);
  });

  it('config fetches the configuration', async () => {
    mockGetConfig.mockResolvedValue(
      ok({ id: 'indexing_config', object: 'indexing_config' }),
    );
    await createProgram().parseAsync(['node', 'cavuno', 'indexing', 'config'], {
      from: 'node',
    });
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it('enable-indexnow toggles true; disable-indexnow toggles false', async () => {
    mockToggleIndexNow.mockResolvedValue(
      ok({ id: 'indexing_config', object: 'indexing_config' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'indexing', 'enable-indexnow'],
      { from: 'node' },
    );
    expect(mockToggleIndexNow).toHaveBeenCalledWith(true, {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'indexing', 'disable-indexnow'],
      { from: 'node' },
    );
    expect(mockToggleIndexNow).toHaveBeenLastCalledWith(false, {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it.each([
    ['enable-indexnow', true],
    ['disable-indexnow', false],
  ] as const)(
    '%s reuses a caller-supplied idempotency key',
    async (command, enabled) => {
      mockToggleIndexNow.mockResolvedValue(
        ok({ id: 'indexing_config', object: 'indexing_config' }),
      );
      await createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'indexing',
          command,
          '--idempotency-key',
          'indexnow-toggle-attempt-1',
        ],
        { from: 'node' },
      );
      expect(mockToggleIndexNow).toHaveBeenCalledWith(enabled, {
        idempotencyKey: 'indexnow-toggle-attempt-1',
      });
    },
  );
});
