import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockList,
  mockGet,
  mockUpdateRole,
  mockRemove,
  mockSuspend,
  mockUnsuspend,
  mockTransfer,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockUpdateRole: vi.fn(),
  mockRemove: vi.fn(),
  mockSuspend: vi.fn(),
  mockUnsuspend: vi.fn(),
  mockTransfer: vi.fn(),
}));

vi.mock('../api/members.js', () => ({
  createMembersClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    updateRole: mockUpdateRole,
    remove: mockRemove,
    suspend: mockSuspend,
    unsuspend: mockUnsuspend,
    transferOwnership: mockTransfer,
  })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerMembersCommand } from '../commands/members.js';

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
  registerMembersCommand(program);
  return program;
}

const run = (...argv: string[]) =>
  createProgram().parseAsync(['node', 'cavuno', 'members', ...argv], {
    from: 'node',
  });

describe('members CLI command', () => {
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

  it('exposes the account-scoped member command surface', () => {
    const program = createProgram();
    const members = program.commands.find((c) => c.name() === 'members')!;
    expect(members.commands.map((c) => c.name()).sort()).toEqual([
      'get',
      'list',
      'remove',
      'suspend',
      'transfer-ownership',
      'unsuspend',
      'update',
    ]);
  });

  it('lists members with the role and suspended filters', async () => {
    mockList.mockResolvedValue(ok({ data: [] }));
    await run('list', '--role', 'admin', '--suspended', 'false');
    expect(mockList).toHaveBeenCalledWith({ role: 'admin', suspended: false });
  });

  it('rejects a non-boolean --suspended before calling the API', async () => {
    await expect(run('list', '--suspended', 'nope')).rejects.toThrow(
      'process.exit unexpectedly called with "2"',
    );
    expect(mockList).not.toHaveBeenCalled();
  });

  it('fetches a member by user ID', async () => {
    mockGet.mockResolvedValue(ok({ id: 'users_1', object: 'member' }));
    await run('get', 'users_1');
    expect(mockGet).toHaveBeenCalledWith('users_1');
  });

  it('updates a member role through PATCH', async () => {
    mockUpdateRole.mockResolvedValue(ok({ id: 'users_1', role: 'admin' }));
    await run('update', 'users_1', '--role', 'admin');
    expect(mockUpdateRole).toHaveBeenCalledWith(
      'users_1',
      'admin',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('removes a member when --yes bypasses the prompt', async () => {
    mockRemove.mockResolvedValue(ok(undefined));
    await run('remove', 'users_1', '--yes');
    expect(mockRemove).toHaveBeenCalledWith(
      'users_1',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('refuses to remove a member without --yes when non-interactive (exit 2)', async () => {
    await expect(run('remove', 'users_1')).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('suspends and unsuspends without a confirmation prompt', async () => {
    mockSuspend.mockResolvedValue(ok({ id: 'users_1', suspended: true }));
    mockUnsuspend.mockResolvedValue(ok({ id: 'users_1', suspended: false }));
    await run('suspend', 'users_1');
    await run('unsuspend', 'users_1');
    expect(mockSuspend).toHaveBeenCalledWith('users_1', expect.anything());
    expect(mockUnsuspend).toHaveBeenCalledWith('users_1', expect.anything());
  });

  it('transfers ownership only with --yes', async () => {
    mockTransfer.mockResolvedValue(ok({ object: 'account' }));
    await run('transfer-ownership', 'users_2', '--yes');
    expect(mockTransfer).toHaveBeenCalledWith('users_2', expect.anything());
  });

  it('refuses transfer-ownership without --yes when non-interactive (exit 2)', async () => {
    await expect(run('transfer-ownership', 'users_2')).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(mockTransfer).not.toHaveBeenCalled();
  });

  it('maps members_not_found to the not-found exit code (4)', async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'members_not_found' } },
      response: new Response(null, { status: 404 }),
    });
    await expect(run('get', 'users_missing')).rejects.toMatchObject({
      exitCode: 4,
    });
  });

  it('maps members_cannot_remove_owner to the conflict exit code (7)', async () => {
    mockRemove.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'members_cannot_remove_owner' } },
      response: new Response(null, { status: 409 }),
    });
    await expect(run('remove', 'users_owner', '--yes')).rejects.toMatchObject({
      exitCode: 7,
    });
  });
});
