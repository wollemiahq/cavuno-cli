import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockCreate, mockUpdateRole, mockRenew, mockRevoke } =
  vi.hoisted(() => ({
    mockList: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdateRole: vi.fn(),
    mockRenew: vi.fn(),
    mockRevoke: vi.fn(),
  }));

vi.mock('../api/invitations.js', () => ({
  createInvitationsClient: vi.fn(() => ({
    list: mockList,
    create: mockCreate,
    updateRole: mockUpdateRole,
    renew: mockRenew,
    revoke: mockRevoke,
  })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerInvitationsCommand } from '../commands/invitations.js';

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
  registerInvitationsCommand(program);
  return program;
}

const run = (...argv: string[]) =>
  createProgram().parseAsync(['node', 'cavuno', 'invitations', ...argv], {
    from: 'node',
  });

describe('invitations CLI command', () => {
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

  it('exposes list, create, update, renew, and revoke', () => {
    const program = createProgram();
    const invitations = program.commands.find(
      (c) => c.name() === 'invitations',
    )!;
    expect(invitations.commands.map((c) => c.name()).sort()).toEqual([
      'create',
      'list',
      'renew',
      'revoke',
      'update',
    ]);
  });

  it('lists invitations with the status filter', async () => {
    mockList.mockResolvedValue(ok({ data: [] }));
    await run('list', '--status', 'pending');
    expect(mockList).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('rejects an out-of-range list limit before calling the API', async () => {
    await expect(run('list', '--limit', '0')).rejects.toThrow(
      'process.exit unexpectedly called with "2"',
    );
    expect(mockList).not.toHaveBeenCalled();
  });

  it('creates an invitation from --email and --role', async () => {
    mockCreate.mockResolvedValue(ok({ id: 'inv_1', token: 'tok' }, 201));
    await run('create', '--email', 'new@acme.com', '--role', 'member');
    expect(mockCreate).toHaveBeenCalledWith(
      { email: 'new@acme.com', role: 'member' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('updates an invitation role through PATCH', async () => {
    mockUpdateRole.mockResolvedValue(ok({ id: 'inv_1', role: 'admin' }));
    await run('update', 'inv_1', '--role', 'admin');
    expect(mockUpdateRole).toHaveBeenCalledWith(
      'inv_1',
      'admin',
      expect.anything(),
    );
  });

  it('renews an invitation (token rotation)', async () => {
    mockRenew.mockResolvedValue(ok({ id: 'inv_1', token: 'new' }));
    await run('renew', 'inv_1');
    expect(mockRenew).toHaveBeenCalledWith('inv_1', expect.anything());
  });

  it('revokes an invitation when --yes bypasses the prompt', async () => {
    mockRevoke.mockResolvedValue(ok(undefined));
    await run('revoke', 'inv_1', '--yes');
    expect(mockRevoke).toHaveBeenCalledWith('inv_1', expect.anything());
  });

  it('refuses to revoke without --yes when non-interactive (exit 2)', async () => {
    await expect(run('revoke', 'inv_1')).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('maps members_seat_limit_exceeded to the conflict exit code (7)', async () => {
    mockCreate.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'members_seat_limit_exceeded' } },
      response: new Response(null, { status: 403 }),
    });
    await expect(
      run('create', '--email', 'x@acme.com', '--role', 'member'),
    ).rejects.toMatchObject({ exitCode: 7 });
  });

  it('maps invitations_not_found to the not-found exit code (4)', async () => {
    mockUpdateRole.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'invitations_not_found' } },
      response: new Response(null, { status: 404 }),
    });
    await expect(
      run('update', 'inv_missing', '--role', 'member'),
    ).rejects.toMatchObject({ exitCode: 4 });
  });
});
