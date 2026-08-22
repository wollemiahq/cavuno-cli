import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockList,
  mockGet,
  mockRemove,
  mockListMemberships,
  mockGetMembership,
  mockListClaims,
  mockApproveClaim,
  mockRejectClaim,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockRemove: vi.fn(),
  mockListMemberships: vi.fn(),
  mockGetMembership: vi.fn(),
  mockListClaims: vi.fn(),
  mockApproveClaim: vi.fn(),
  mockRejectClaim: vi.fn(),
}));

vi.mock('../api/employers.js', () => ({
  createEmployersClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    remove: mockRemove,
    listMemberships: mockListMemberships,
    getMembership: mockGetMembership,
    listClaims: mockListClaims,
    approveClaim: mockApproveClaim,
    rejectClaim: mockRejectClaim,
  })),
}));

import { registerEmployersCommand } from '../commands/employers.js';

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
  registerEmployersCommand(program);
  return program;
}

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: new Response(null, { status: 200 }),
});

describe('employers CLI command', () => {
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

  it('registers the full employer subcommand surface', () => {
    const employers = createProgram().commands.find(
      (c) => c.name() === 'employers',
    );
    expect(employers).toBeDefined();
    expect(employers!.commands.map((c) => c.name()).sort()).toEqual([
      'approve-claim',
      'claims',
      'delete',
      'get',
      'list',
      'membership',
      'memberships',
      'reject-claim',
    ]);
  });

  it('fetches a single membership by id', async () => {
    mockGetMembership.mockResolvedValue(
      ok({ id: 'pd7abc', object: 'employer_membership', status: 'approved' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'employers', 'membership', 'pd7abc'],
      { from: 'node' },
    );
    expect(mockGetMembership).toHaveBeenCalledWith('pd7abc');
  });

  it('lists claims filtered by status', async () => {
    mockListClaims.mockResolvedValue(ok({ data: [] }));
    await createProgram().parseAsync(
      ['node', 'cavuno', 'employers', 'claims', '--status', 'approved'],
      { from: 'node' },
    );
    expect(mockListClaims).toHaveBeenCalledWith({ status: 'approved' });
  });

  it('approves a claim with an idempotency key', async () => {
    mockApproveClaim.mockResolvedValue(
      ok({ id: 'pd7abc', object: 'company_claim', status: 'approved' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'employers', 'approve-claim', 'pd7abc'],
      { from: 'node' },
    );
    expect(mockApproveClaim).toHaveBeenCalledWith('pd7abc', {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('rejects a claim with an idempotency key', async () => {
    mockRejectClaim.mockResolvedValue(
      ok({ id: 'pd7abc', object: 'company_claim', status: 'rejected' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'employers', 'reject-claim', 'pd7abc'],
      { from: 'node' },
    );
    expect(mockRejectClaim).toHaveBeenCalledWith('pd7abc', {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('deletes an employer (GDPR cascade) and prints the operation', async () => {
    mockRemove.mockResolvedValue(
      ok({ id: 'ops_1', object: 'operation', kind: 'employers.remove' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'employers', 'delete', 'nh7abc', '--yes'],
      { from: 'node' },
    );
    expect(mockRemove).toHaveBeenCalledWith('nh7abc', {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('refuses to delete an employer without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'employers', 'delete', 'nh7abc'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it.each([
    ['delete', mockRemove, ['nh7abc', { idempotencyKey: 'idem-test' }]],
    [
      'approve-claim',
      mockApproveClaim,
      ['nh7abc', { idempotencyKey: 'idem-test' }],
    ],
    [
      'reject-claim',
      mockRejectClaim,
      ['nh7abc', { idempotencyKey: 'idem-test' }],
    ],
  ] as const)(
    '%s reuses a caller-supplied idempotency key',
    async (command, mock, expectedArguments) => {
      mock.mockResolvedValue(ok({ id: 'ops_1', object: 'operation' }));
      await createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'employers',
          command,
          'nh7abc',
          ...(command === 'delete' ? ['--yes'] : []),
          '--idempotency-key',
          'idem-test',
        ],
        { from: 'node' },
      );
      expect(mock).toHaveBeenCalledWith(...expectedArguments);
    },
  );
});
