import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockCreate, mockUpdate, mockRemove, mockBatch } = vi.hoisted(
  () => ({
    mockList: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockRemove: vi.fn(),
    mockBatch: vi.fn(),
  }),
);

vi.mock('../api/redirects.js', () => ({
  createRedirectsClient: vi.fn(() => ({
    list: mockList,
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
    batch: mockBatch,
  })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerRedirectsCommand } from '../commands/redirects.js';

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
  registerRedirectsCommand(program);
  return program;
}

describe('redirects CLI command registration', () => {
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

  it('exposes list, create, update, remove, and batch commands', () => {
    const program = createProgram();
    const redirects = program.commands.find((c) => c.name() === 'redirects');
    expect(redirects).toBeDefined();

    const subcommands = redirects!.commands.map((c) => c.name()).sort();
    expect(subcommands).toEqual([
      'batch',
      'create',
      'list',
      'remove',
      'update',
    ]);
  });

  it('creates a redirect through POST /v1/redirects', async () => {
    mockCreate.mockResolvedValue({
      data: { id: 'redir_123', object: 'redirect' },
      error: undefined,
      response: new Response(null, { status: 201 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'redirects', 'create', '/old', '/new'],
      { from: 'node' },
    );

    expect(mockCreate).toHaveBeenCalledWith(
      { fromPath: '/old', toPath: '/new', statusCode: 301 },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('lists redirects with search and limit', async () => {
    mockList.mockResolvedValue({
      data: { object: 'list', data: [] },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'redirects',
        'list',
        '--search',
        '/old',
        '--limit',
        '10',
      ],
      { from: 'node' },
    );

    expect(mockList).toHaveBeenCalledWith({ search: '/old', limit: 10 });
  });

  it('removes a redirect through DELETE when --yes bypasses the prompt', async () => {
    mockRemove.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'redirects', 'remove', 'redir_123', '--yes'],
      { from: 'node' },
    );

    expect(mockRemove).toHaveBeenCalledWith(
      'redir_123',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('refuses to remove a redirect without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'redirects', 'remove', 'redir_123'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('maps redirects_not_found to the standard not-found exit code', async () => {
    mockUpdate.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'redirects_not_found' } },
      response: new Response(null, { status: 404 }),
    });

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'redirects', 'update', 'missing', '--to-path', '/x'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 4 });
  });

  it('rejects non-numeric list limits before calling the API', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'redirects', 'list', '--limit', 'abc'],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');

    expect(mockList).not.toHaveBeenCalled();
  });
});
