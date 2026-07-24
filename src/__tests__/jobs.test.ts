import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, mockUpdate, mockList, mockSearch, mockRemove } = vi.hoisted(
  () => ({
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockList: vi.fn(),
    mockSearch: vi.fn(),
    mockRemove: vi.fn(),
  }),
);

vi.mock('../api/jobs.js', () => ({
  createJobsClient: vi.fn(() => ({
    create: mockCreate,
    update: mockUpdate,
    list: mockList,
    search: mockSearch,
    remove: mockRemove,
  })),
}));

vi.mock('../api/usage.js', () => ({
  createUsageClient: vi.fn(() => ({})),
}));

import { registerJobsCommand } from '../commands/jobs.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function success(data: unknown = {}) {
  return {
    data,
    error: undefined,
    response: new Response(null, { status: 200 }),
  };
}

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
  registerJobsCommand(program);
  return program;
}

describe('jobs taxonomy CLI options', () => {
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
    mockCreate.mockResolvedValue(success());
    mockUpdate.mockResolvedValue(success());
    mockList.mockResolvedValue(success({ data: [] }));
    mockSearch.mockResolvedValue(success({ data: [] }));
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
  });

  it('forwards canonical comma-separated slugs on create', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'jobs',
        'create',
        '--title',
        'Platform Engineer',
        '--skills',
        'typescript, kubernetes',
        '--categories',
        'engineering, infrastructure',
      ],
      { from: 'node' },
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: ['typescript', 'kubernetes'],
        categories: ['engineering', 'infrastructure'],
      }),
    );
  });

  it('forwards an empty taxonomy list on update so callers can clear it', async () => {
    await createProgram().parseAsync(
      ['node', 'cavuno', 'jobs', 'update', 'job_123', '--skills', ''],
      { from: 'node' },
    );

    expect(mockUpdate).toHaveBeenCalledWith('job_123', { skills: [] });
  });

  it('routes taxonomy-filtered listing through search even without free text', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'jobs',
        'list',
        '--skills',
        'typescript,python',
        '--categories',
        'engineering',
      ],
      { from: 'node' },
    );

    expect(mockSearch).toHaveBeenCalledWith({
      filters: {
        skills: ['typescript', 'python'],
        categories: ['engineering'],
      },
    });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('delete refuses without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'jobs', 'delete', 'k17abc'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('delete calls the API with --yes', async () => {
    mockRemove.mockResolvedValue(success());
    await createProgram().parseAsync(
      ['node', 'cavuno', 'jobs', 'delete', 'k17abc', '--yes'],
      { from: 'node' },
    );
    expect(mockRemove).toHaveBeenCalledWith('k17abc');
  });
});
