import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockList,
  mockGet,
  mockCreate,
  mockUpdate,
  mockDelete,
  mockRedetect,
  mockListRuns,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockRedetect: vi.fn(),
  mockListRuns: vi.fn(),
}));

vi.mock('../api/job-feeds.js', () => ({
  createJobFeedsClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
    redetectMapping: mockRedetect,
    listRuns: mockListRuns,
  })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerJobFeedsCommand } from '../commands/job-feeds.js';

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
  registerJobFeedsCommand(program);
  return program;
}

const ok = (data: unknown, status = 200) => ({
  data,
  error: undefined,
  response: new Response(null, { status }),
});

function run(...args: string[]) {
  return createProgram().parseAsync(['node', 'cavuno', 'job-feeds', ...args], {
    from: 'node',
  });
}

describe('job-feeds CLI command', () => {
  let originalKey: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'http://localhost:3000/api/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('registers the full job-feeds subcommand surface', () => {
    const group = createProgram().commands.find(
      (c) => c.name() === 'job-feeds',
    );
    expect(group!.commands.map((c) => c.name()).sort()).toEqual([
      'create',
      'delete',
      'get',
      'list',
      'redetect-mapping',
      'runs',
      'update',
    ]);
  });

  it('list forwards pagination', async () => {
    mockList.mockResolvedValue(ok({ data: [] }));
    await run('list', '--limit', '10', '--cursor', 'c1');
    expect(mockList).toHaveBeenCalledWith({ limit: 10, cursor: 'c1' });
  });

  it('create sends only the given fields with an idempotency key', async () => {
    mockCreate.mockResolvedValue(ok({ id: 'feed_1', object: 'job_feed' }, 201));
    await run(
      'create',
      '--url',
      'https://ats.example.com/jobs.xml',
      '--interval-hours',
      '12',
      '--job-limit',
      'none',
    );
    expect(mockCreate).toHaveBeenCalledWith(
      {
        url: 'https://ats.example.com/jobs.xml',
        intervalHours: 12,
        jobLimit: null,
      },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
  });

  it('rejects an unsupported interval before calling the API', async () => {
    await expect(
      run('create', '--url', 'https://a.example/x', '--interval-hours', '2'),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('update parses booleans and a JSON mapping', async () => {
    mockUpdate.mockResolvedValue(ok({ id: 'feed_1', object: 'job_feed' }));
    const mapping = {
      fieldMappings: [
        { sourceColumn: 'job.title', targetField: 'title', confidence: 1 },
      ],
    };
    await run(
      'update',
      'feed_1',
      '--enabled',
      'false',
      '--mapping',
      JSON.stringify(mapping),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      'feed_1',
      { enabled: false, mapping },
      { idempotencyKey: expect.any(String) },
    );
  });

  it('update with no fields exits 2', async () => {
    await expect(run('update', 'feed_1')).rejects.toThrow(
      'process.exit unexpectedly called with "2"',
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('delete requires --yes when not interactive', async () => {
    await expect(run('delete', 'feed_1')).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(mockDelete).not.toHaveBeenCalled();

    mockDelete.mockResolvedValue(ok(undefined, 204));
    await run('delete', 'feed_1', '--yes');
    expect(mockDelete).toHaveBeenCalledWith('feed_1', {
      idempotencyKey: expect.any(String),
    });
  });

  it('get maps job_feeds_not_found to the not-found exit code', async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'job_feeds_not_found' } },
      response: new Response(null, { status: 404 }),
    });
    await expect(run('get', 'feed_missing')).rejects.toMatchObject({
      exitCode: 4,
    });
  });

  it('redetect-mapping and runs hit their endpoints', async () => {
    mockRedetect.mockResolvedValue(ok({ id: 'feed_1', mapping: null }));
    mockListRuns.mockResolvedValue(ok({ data: [] }));
    await run('redetect-mapping', 'feed_1');
    await run('runs', 'feed_1', '--limit', '5');
    expect(mockRedetect).toHaveBeenCalledWith('feed_1', {
      idempotencyKey: expect.any(String),
    });
    expect(mockListRuns).toHaveBeenCalledWith('feed_1', { limit: 5 });
  });
});
