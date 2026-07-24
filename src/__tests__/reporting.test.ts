import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListIntegrations,
  mockGetIntegration,
  mockConnect,
  mockSetEnabled,
  mockDisconnect,
} = vi.hoisted(() => ({
  mockListIntegrations: vi.fn(),
  mockGetIntegration: vi.fn(),
  mockConnect: vi.fn(),
  mockSetEnabled: vi.fn(),
  mockDisconnect: vi.fn(),
}));

vi.mock('../api/reporting.js', () => ({
  createReportingClient: vi.fn(() => ({
    listIntegrations: mockListIntegrations,
    getIntegration: mockGetIntegration,
    connect: mockConnect,
    setEnabled: mockSetEnabled,
    disconnect: mockDisconnect,
  })),
}));

import { registerReportingCommand } from '../commands/reporting.js';

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
  registerReportingCommand(program);
  return program;
}

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: new Response(null, { status: 200 }),
});

describe('reporting CLI command', () => {
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

  it('registers the full reporting subcommand surface', () => {
    const reporting = createProgram().commands.find(
      (c) => c.name() === 'reporting',
    );
    expect(reporting).toBeDefined();
    expect(reporting!.commands.map((c) => c.name()).sort()).toEqual([
      'connect',
      'disable',
      'disconnect',
      'enable',
      'get',
      'integrations',
    ]);
  });

  it('enable forwards provider + true; disable forwards false', async () => {
    mockSetEnabled.mockResolvedValue(
      ok({ id: 'x', object: 'reporting_integration' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'reporting', 'enable', 'adsense'],
      { from: 'node' },
    );
    expect(mockSetEnabled).toHaveBeenCalledWith('adsense', true, {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'reporting', 'disable', 'adsense'],
      { from: 'node' },
    );
    expect(mockSetEnabled).toHaveBeenLastCalledWith('adsense', false, {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('connect and disconnect supply idempotency keys', async () => {
    mockConnect.mockResolvedValue(
      ok({ id: 'x', object: 'reporting_integration' }),
    );
    mockDisconnect.mockResolvedValue(ok(undefined));

    await createProgram().parseAsync(
      ['node', 'cavuno', 'reporting', 'connect', 'adsense'],
      { from: 'node' },
    );
    expect(mockConnect).toHaveBeenCalledWith('adsense', {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'reporting', 'disconnect', 'adsense', '--yes'],
      { from: 'node' },
    );
    expect(mockDisconnect).toHaveBeenCalledWith('adsense', {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('refuses to disconnect without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'reporting', 'disconnect', 'adsense'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it.each([
    [
      'connect',
      mockConnect,
      ['adsense', { idempotencyKey: 'reporting-mutation-attempt-1' }],
    ],
    [
      'enable',
      mockSetEnabled,
      ['adsense', true, { idempotencyKey: 'reporting-mutation-attempt-1' }],
    ],
    [
      'disable',
      mockSetEnabled,
      ['adsense', false, { idempotencyKey: 'reporting-mutation-attempt-1' }],
    ],
    [
      'disconnect',
      mockDisconnect,
      ['adsense', { idempotencyKey: 'reporting-mutation-attempt-1' }],
    ],
  ] as const)(
    '%s reuses a caller-supplied idempotency key',
    async (command, mock, expectedArguments) => {
      mock.mockResolvedValue(ok({ id: 'x', object: 'reporting_integration' }));
      await createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'reporting',
          command,
          'adsense',
          ...(command === 'disconnect' ? ['--yes'] : []),
          '--idempotency-key',
          'reporting-mutation-attempt-1',
        ],
        { from: 'node' },
      );
      expect(mock).toHaveBeenCalledWith(...expectedArguments);
    },
  );
});
