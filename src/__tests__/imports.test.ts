import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  mockList,
  mockGet,
  mockCreate,
  mockConfirm,
  mockCancel,
  mockQuota,
  mockOpsGet,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockCreate: vi.fn(),
  mockConfirm: vi.fn(),
  mockCancel: vi.fn(),
  mockQuota: vi.fn(),
  mockOpsGet: vi.fn(),
}));

vi.mock('../api/imports.js', () => ({
  createImportsClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    create: mockCreate,
    confirm: mockConfirm,
    cancel: mockCancel,
    quota: mockQuota,
  })),
}));

vi.mock('../api/operations.js', () => ({
  createOperationsClient: vi.fn(() => ({ get: mockOpsGet })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerImportsCommand } from '../commands/imports.js';

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
  registerImportsCommand(program);
  return program;
}

const ok = (data: unknown, status = 200) => ({
  data,
  error: undefined,
  response: new Response(null, { status }),
});

describe('imports CLI command', () => {
  let originalKey: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let tmp: string;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'http://localhost:3000/api/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    tmp = mkdtempSync(join(tmpdir(), 'cavuno-imports-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('registers the full imports subcommand surface', () => {
    const imports = createProgram().commands.find(
      (c) => c.name() === 'imports',
    );
    expect(imports).toBeDefined();
    expect(imports!.commands.map((c) => c.name()).sort()).toEqual([
      'cancel',
      'confirm',
      'create',
      'get',
      'list',
      'quota',
    ]);
  });

  it('list forwards status + range filters', async () => {
    mockList.mockResolvedValue(ok({ data: [] }));
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'imports',
        'list',
        '--status',
        'completed',
        '--from',
        '2026-04-01T00:00:00.000Z',
        '--limit',
        '10',
      ],
      { from: 'node' },
    );
    expect(mockList).toHaveBeenCalledWith({
      status: 'completed',
      from: '2026-04-01T00:00:00.000Z',
      limit: 10,
    });
  });

  it('rejects out-of-range list limits before calling the API', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'imports', 'list', '--limit', '51'],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('get maps imports_not_found to the not-found exit code', async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'imports_not_found' } },
      response: new Response(null, { status: 404 }),
    });
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'imports', 'get', 'imports_missing'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 4 });
  });

  it('create uploads a CSV Blob with a generated idempotency key', async () => {
    mockCreate.mockResolvedValue(
      ok({ id: 'op_imp', object: 'operation' }, 202),
    );
    const file = join(tmp, 'jobs.csv');
    writeFileSync(file, 'title,url\nEngineer,https://x');

    await createProgram().parseAsync(
      ['node', 'cavuno', 'imports', 'create', file],
      { from: 'node' },
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [options, idempotency] = mockCreate.mock.calls[0]!;
    expect(options.file).toBeInstanceOf(Blob);
    expect(await (options.file as Blob).text()).toBe(
      'title,url\nEngineer,https://x',
    );
    expect(options.fileName).toBe('jobs.csv');
    expect(options.sourceFormat).toBe('csv');
    expect(idempotency).toEqual({
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('create --wait polls the returned operation until terminal', async () => {
    mockCreate.mockResolvedValue(
      ok({ id: 'op_imp', object: 'operation' }, 202),
    );
    mockOpsGet.mockResolvedValue(
      ok({ id: 'op_imp', object: 'operation', state: 'succeeded' }),
    );
    const file = join(tmp, 'jobs.csv');
    writeFileSync(file, 'a,b\n1,2');

    await createProgram().parseAsync(
      ['node', 'cavuno', 'imports', 'create', file, '--wait'],
      { from: 'node' },
    );

    expect(mockOpsGet).toHaveBeenCalledWith('op_imp');
  });

  it('confirm forwards a parsed inline mapping and an idempotency key', async () => {
    mockConfirm.mockResolvedValue(
      ok({ id: 'op_conf', object: 'operation' }, 202),
    );
    const inlineMapping = {
      schemaFingerprint: 'fp',
      sourceFormat: 'csv',
      fieldMappings: [
        { sourceColumn: 'Title', targetField: 'title', confidence: 1 },
      ],
    };

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'imports',
        'confirm',
        'imports_k25',
        '--inline-mapping',
        JSON.stringify(inlineMapping),
      ],
      { from: 'node' },
    );

    expect(mockConfirm).toHaveBeenCalledWith(
      'imports_k25',
      { inlineMapping },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
  });

  it('confirm with no inline mapping sends an empty body (batch-attached mapping)', async () => {
    mockConfirm.mockResolvedValue(
      ok({ id: 'op_conf', object: 'operation' }, 202),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'imports', 'confirm', 'imports_k25'],
      { from: 'node' },
    );
    expect(mockConfirm).toHaveBeenCalledWith(
      'imports_k25',
      {},
      {
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    );
  });

  it('confirm rejects an invalid inline-mapping JSON before calling the API', async () => {
    await expect(
      createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'imports',
          'confirm',
          'imports_k25',
          '--inline-mapping',
          '{not json',
        ],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('cancel runs cooperatively with no confirmation prompt', async () => {
    mockCancel.mockResolvedValue(
      ok({ id: 'imports_k25', status: 'cancelled' }),
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'imports', 'cancel', 'imports_k25'],
      { from: 'node' },
    );
    expect(mockCancel).toHaveBeenCalledWith('imports_k25', {
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('quota fetches the daily usage', async () => {
    mockQuota.mockResolvedValue(ok({ object: 'import_quota', remaining: 43 }));
    await createProgram().parseAsync(['node', 'cavuno', 'imports', 'quota'], {
      from: 'node',
    });
    expect(mockQuota).toHaveBeenCalled();
  });
});
