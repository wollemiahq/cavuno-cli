import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock('../api/me.js', () => ({
  createMeClient: vi.fn(() => ({
    get: mockGet,
  })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerMeCommand } from '../commands/me.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const ok = (data: unknown, status = 200) => ({
  data,
  error: undefined,
  response: new Response(null, { status }),
});

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
  registerMeCommand(program);
  return program;
}

const run = (...argv: string[]) =>
  createProgram().parseAsync(['node', 'cavuno', 'me', ...argv], {
    from: 'node',
  });

describe('me CLI command', () => {
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

  it('exposes the me get command mapped to GET /v1/me', () => {
    const program = createProgram();
    const me = program.commands.find((c) => c.name() === 'me')!;
    expect(me.commands.map((c) => c.name())).toEqual(['get']);
  });

  it('prints the operator identity payload', async () => {
    const payload = {
      object: 'operator',
      board: { id: 'acc_1', slug: 'acme', name: 'Acme' },
      actor: {
        type: 'api_key',
        role: null,
        permissions: ['members.self'],
        scopes: ['members.self'],
      },
    };
    mockGet.mockResolvedValue(ok(payload));
    await run('get');
    expect(mockGet).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
  });
});
