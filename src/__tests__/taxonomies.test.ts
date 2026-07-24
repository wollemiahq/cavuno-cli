import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  remotePermits: vi.fn(),
  remoteTimezones: vi.fn(),
  skillsList: vi.fn(),
  skillsCreate: vi.fn(),
  skillsAddAliases: vi.fn(),
  categoriesTree: vi.fn(),
  marketsCreate: vi.fn(),
}));

vi.mock('../api/taxonomies.js', () => ({
  createTaxonomiesClient: vi.fn(() => ({
    remotePermits: mocks.remotePermits,
    remoteTimezones: mocks.remoteTimezones,
    skillsList: mocks.skillsList,
    skillsGet: vi.fn(),
    skillsCreate: mocks.skillsCreate,
    skillsUpdate: vi.fn(),
    skillsDelete: vi.fn(),
    skillsAddAliases: mocks.skillsAddAliases,
    skillsRemoveAlias: vi.fn(),
    categoriesList: vi.fn(),
    categoriesTree: mocks.categoriesTree,
    categoriesGet: vi.fn(),
    categoriesCreate: vi.fn(),
    categoriesUpdate: vi.fn(),
    categoriesDelete: vi.fn(),
    categoriesAddAliases: vi.fn(),
    categoriesRemoveAlias: vi.fn(),
    marketsList: vi.fn(),
    marketsGet: vi.fn(),
    marketsCreate: mocks.marketsCreate,
    marketsUpdate: vi.fn(),
    marketsDelete: vi.fn(),
    marketsAddAliases: vi.fn(),
    marketsRemoveAlias: vi.fn(),
  })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerTaxonomiesCommand } from '../commands/taxonomies.js';

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
  registerTaxonomiesCommand(program);
  return program;
}

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: new Response(null, { status: 200 }),
});

describe('taxonomies CLI', () => {
  let originalKey: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_KEY = VALID_KEY;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    logSpy.mockRestore();
  });

  it('fetches remote permits and timezones', async () => {
    mocks.remotePermits.mockResolvedValue(ok({ data: [] }));
    mocks.remoteTimezones.mockResolvedValue(ok({ data: [] }));

    await createProgram().parseAsync(
      ['node', 'cavuno', 'taxonomies', 'remote-permits'],
      { from: 'node' },
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'taxonomies', 'remote-timezones'],
      { from: 'node' },
    );

    expect(mocks.remotePermits).toHaveBeenCalled();
    expect(mocks.remoteTimezones).toHaveBeenCalled();
  });

  it('skills list and create pass through to the client', async () => {
    mocks.skillsList.mockResolvedValue(ok({ object: 'list', data: [] }));
    mocks.skillsCreate.mockResolvedValue(
      ok({ object: 'skill', id: 'sk_1', slug: 'typescript' }),
    );

    await createProgram().parseAsync(
      ['node', 'cavuno', 'taxonomies', 'skills', 'list', '--limit', '10'],
      { from: 'node' },
    );
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'taxonomies',
        'skills',
        'create',
        '--name',
        'TypeScript',
        '--slug',
        'typescript',
      ],
      { from: 'node' },
    );

    expect(mocks.skillsList).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
    expect(mocks.skillsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TypeScript', slug: 'typescript' }),
    );
  });

  it('skills add-alias dual-write path sends aliases array', async () => {
    mocks.skillsAddAliases.mockResolvedValue(
      ok({ object: 'skill', aliasSlugs: ['ts'] }),
    );

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'taxonomies',
        'skills',
        'add-alias',
        'sk_1',
        '--alias',
        'ts,typescript-lang',
      ],
      { from: 'node' },
    );

    expect(mocks.skillsAddAliases).toHaveBeenCalledWith('sk_1', {
      aliases: ['ts', 'typescript-lang'],
    });
  });

  it('categories tree and markets create are wired', async () => {
    mocks.categoriesTree.mockResolvedValue(ok({ object: 'list', data: [] }));
    mocks.marketsCreate.mockResolvedValue(
      ok({ object: 'market', slug: 'saas' }),
    );

    await createProgram().parseAsync(
      ['node', 'cavuno', 'taxonomies', 'categories', 'tree'],
      { from: 'node' },
    );
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'taxonomies',
        'markets',
        'create',
        '--name',
        'SaaS',
        '--slug',
        'saas',
      ],
      { from: 'node' },
    );

    expect(mocks.categoriesTree).toHaveBeenCalled();
    expect(mocks.marketsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SaaS', slug: 'saas' }),
    );
  });
});
