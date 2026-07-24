import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockList,
  mockGet,
  mockDownloadResume,
  mockRemove,
  mockOpsGet,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockDownloadResume: vi.fn(),
  mockRemove: vi.fn(),
  mockOpsGet: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ writeFile: mockWriteFile }));

vi.mock('../api/candidates.js', () => ({
  createCandidatesClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    downloadResume: mockDownloadResume,
    remove: mockRemove,
  })),
}));

vi.mock('../api/operations.js', () => ({
  createOperationsClient: vi.fn(() => ({ get: mockOpsGet })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerCandidatesCommand } from '../commands/candidates.js';

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
  registerCandidatesCommand(program);
  return program;
}

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: new Response(null, { status: 200 }),
});

describe('candidates CLI command', () => {
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

  it('registers list / get / resume / delete subcommands', () => {
    const candidates = createProgram().commands.find(
      (c) => c.name() === 'candidates',
    );
    expect(candidates).toBeDefined();
    expect(candidates!.commands.map((c) => c.name()).sort()).toEqual([
      'delete',
      'get',
      'list',
      'resume',
    ]);
  });

  it('forwards list filters to the client', async () => {
    mockList.mockResolvedValue(ok({ data: [] }));
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'candidates',
        'list',
        '--search',
        'alice',
        '--has-resume',
        '--limit',
        '10',
      ],
      { from: 'node' },
    );
    expect(mockList).toHaveBeenCalledWith({
      search: 'alice',
      hasResume: true,
      limit: 10,
    });
  });

  it('deletes a candidate (GDPR cascade) and prints the operation with --yes', async () => {
    mockRemove.mockResolvedValue(
      ok({ id: 'ops_1', object: 'operation', kind: 'candidates.remove' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'candidates', 'delete', 'nh7abc', '--yes'],
      { from: 'node' },
    );
    expect(mockRemove).toHaveBeenCalledWith('nh7abc', {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('downloads a resume to the requested local path', async () => {
    mockDownloadResume.mockResolvedValue(ok(new Uint8Array([1, 2, 3]).buffer));

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'candidates',
        'resume',
        'nh7abc',
        '--output',
        './resume.pdf',
      ],
      { from: 'node' },
    );

    expect(mockDownloadResume).toHaveBeenCalledWith('nh7abc');
    expect(mockWriteFile).toHaveBeenCalledWith(
      './resume.pdf',
      Buffer.from([1, 2, 3]),
    );
  });

  it('refuses to delete a candidate without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'candidates', 'delete', 'nh7abc'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('reuses a caller-supplied idempotency key when retrying a delete', async () => {
    mockRemove.mockResolvedValue(
      ok({ id: 'ops_1', object: 'operation', kind: 'candidates.remove' }),
    );
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'candidates',
        'delete',
        'nh7abc',
        '--yes',
        '--idempotency-key',
        'candidate-delete-attempt-1',
      ],
      { from: 'node' },
    );
    expect(mockRemove).toHaveBeenCalledWith('nh7abc', {
      idempotencyKey: 'candidate-delete-attempt-1',
    });
  });

  it('delete --wait polls the remove operation and prints the terminal envelope', async () => {
    mockRemove.mockResolvedValue(
      ok({ id: 'ops_1', object: 'operation', kind: 'candidates.remove' }),
    );
    mockOpsGet.mockResolvedValue(
      ok({ id: 'ops_1', object: 'operation', state: 'succeeded' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'candidates', 'delete', 'nh7abc', '--yes', '--wait'],
      { from: 'node' },
    );
    expect(mockOpsGet).toHaveBeenCalledWith('ops_1');
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        { id: 'ops_1', object: 'operation', state: 'succeeded' },
        null,
        2,
      ),
    );
  });
});
