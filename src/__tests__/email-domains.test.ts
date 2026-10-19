import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockGet, mockAdd, mockUpdate, mockVerify, mockRemove } =
  vi.hoisted(() => ({
    mockList: vi.fn(),
    mockGet: vi.fn(),
    mockAdd: vi.fn(),
    mockUpdate: vi.fn(),
    mockVerify: vi.fn(),
    mockRemove: vi.fn(),
  }));

vi.mock('../api/email-domains.js', () => ({
  createEmailDomainsClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    add: mockAdd,
    update: mockUpdate,
    verify: mockVerify,
    remove: mockRemove,
  })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerEmailDomainsCommand } from '../commands/email-domains.js';

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
  registerEmailDomainsCommand(program);
  return program;
}

function ok(data: unknown, status = 200) {
  return {
    data,
    error: undefined,
    response: new Response(null, { status }),
  };
}

describe('email-domains CLI command registration', () => {
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

  it('exposes list, get, add, update, verify, and remove commands', () => {
    const program = createProgram();
    const group = program.commands.find((c) => c.name() === 'email-domains');
    expect(group).toBeDefined();

    const subcommands = group!.commands.map((c) => c.name()).sort();
    expect(subcommands).toEqual([
      'add',
      'get',
      'list',
      'remove',
      'update',
      'verify',
    ]);
  });

  it('adds a domain through POST /v1/email-domains with the sender options', async () => {
    mockAdd.mockResolvedValue(ok({ id: 'ed_123' }, 201));

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'email-domains',
        'add',
        'notifications.example.com',
        '--sender-name',
        'Acme Jobs',
        '--sender-local-part',
        'hello',
      ],
      { from: 'node' },
    );

    expect(mockAdd).toHaveBeenCalledWith({
      domain: 'notifications.example.com',
      senderName: 'Acme Jobs',
      senderLocalPart: 'hello',
    });
  });

  it('adds a domain with only the hostname', async () => {
    mockAdd.mockResolvedValue(ok({ id: 'ed_123' }, 201));

    await createProgram().parseAsync(
      ['node', 'cavuno', 'email-domains', 'add', 'notifications.example.com'],
      { from: 'node' },
    );

    expect(mockAdd).toHaveBeenCalledWith({
      domain: 'notifications.example.com',
    });
  });

  it('updates the sender through PATCH /v1/email-domains/:id', async () => {
    mockUpdate.mockResolvedValue(ok({ id: 'ed_123' }));

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'email-domains',
        'update',
        'ed_123',
        '--sender-name',
        'Acme Careers',
      ],
      { from: 'node' },
    );

    expect(mockUpdate).toHaveBeenCalledWith('ed_123', {
      senderName: 'Acme Careers',
    });
  });

  it('verifies through POST /v1/email-domains/:id/verify', async () => {
    mockVerify.mockResolvedValue(ok({ id: 'ed_123', status: 'verified' }));

    await createProgram().parseAsync(
      ['node', 'cavuno', 'email-domains', 'verify', 'ed_123'],
      { from: 'node' },
    );

    expect(mockVerify).toHaveBeenCalledWith('ed_123');
  });

  it('removes through DELETE /v1/email-domains/:id when --yes bypasses the prompt', async () => {
    mockRemove.mockResolvedValue(ok(undefined, 204));

    await createProgram().parseAsync(
      ['node', 'cavuno', 'email-domains', 'remove', 'ed_123', '--yes'],
      { from: 'node' },
    );

    expect(mockRemove).toHaveBeenCalledWith('ed_123');
  });

  it('refuses to remove without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'email-domains', 'remove', 'ed_123'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });

    expect(mockRemove).not.toHaveBeenCalled();
  });
});
