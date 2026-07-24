import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockList,
  mockGet,
  mockCreate,
  mockUpdate,
  mockRemove,
  mockPublish,
  mockUnpublish,
  mockToggleFeatured,
  mockSearch,
  mockAuthorsList,
  mockAuthorsGet,
  mockAuthorsCreate,
  mockAuthorsUpdate,
  mockAuthorsDelete,
  mockBatch,
  mockTagsList,
  mockTagsGet,
  mockTagsCreate,
  mockTagsUpdate,
  mockTagsDelete,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockRemove: vi.fn(),
  mockPublish: vi.fn(),
  mockUnpublish: vi.fn(),
  mockToggleFeatured: vi.fn(),
  mockSearch: vi.fn(),
  mockBatch: vi.fn(),
  mockAuthorsList: vi.fn(),
  mockAuthorsGet: vi.fn(),
  mockAuthorsCreate: vi.fn(),
  mockAuthorsUpdate: vi.fn(),
  mockAuthorsDelete: vi.fn(),
  mockTagsList: vi.fn(),
  mockTagsGet: vi.fn(),
  mockTagsCreate: vi.fn(),
  mockTagsUpdate: vi.fn(),
  mockTagsDelete: vi.fn(),
}));

vi.mock('../api/blog.js', () => ({
  createBlogClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
    publish: mockPublish,
    unpublish: mockUnpublish,
    toggleFeatured: mockToggleFeatured,
    search: mockSearch,
    batch: mockBatch,
    authorsList: mockAuthorsList,
    authorsGet: mockAuthorsGet,
    authorsCreate: mockAuthorsCreate,
    authorsUpdate: mockAuthorsUpdate,
    authorsDelete: mockAuthorsDelete,
    tagsList: mockTagsList,
    tagsGet: mockTagsGet,
    tagsCreate: mockTagsCreate,
    tagsUpdate: mockTagsUpdate,
    tagsDelete: mockTagsDelete,
  })),
}));

import { registerBlogCommand } from '../commands/blog.js';
import { CliError } from '../lib/auth.js';

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
  registerBlogCommand(program);
  return program;
}

const run = (...argv: string[]) =>
  createProgram().parseAsync(['node', 'cavuno', 'blog', ...argv], {
    from: 'node',
  });

describe('blog CLI command registration', () => {
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

  it('registers posts, authors, and tags groups with their subcommands', () => {
    const program = createProgram();
    const blog = program.commands.find((c) => c.name() === 'blog');
    expect(blog).toBeDefined();

    const groups = blog!.commands.map((c) => c.name()).sort();
    expect(groups).toEqual(['authors', 'posts', 'tags']);

    const sub = (name: string) =>
      blog!.commands
        .find((c) => c.name() === name)!
        .commands.map((c) => c.name())
        .sort();

    expect(sub('posts')).toEqual([
      'batch',
      'create',
      'delete',
      'get',
      'list',
      'publish',
      'search',
      'toggle-featured',
      'unpublish',
      'update',
    ]);
    expect(sub('authors')).toEqual([
      'create',
      'delete',
      'get',
      'list',
      'update',
    ]);
    expect(sub('tags')).toEqual(['create', 'delete', 'get', 'list', 'update']);
  });

  it('passes the --status filter through to the posts list client call', async () => {
    mockList.mockResolvedValue(ok({ object: 'list', data: [] }));

    await run('posts', 'list', '--status', 'draft');

    expect(mockList).toHaveBeenCalledOnce();
    expect(mockList.mock.calls[0]![0]).toMatchObject({ status: 'draft' });
  });

  it('assembles the create body, parses comma-separated author IDs, and omits unset fields', async () => {
    mockCreate.mockResolvedValue(ok({ id: 'k1', object: 'blog_post' }, 201));

    await run(
      'posts',
      'create',
      '--title',
      'Hiring trends',
      '--author-ids',
      'k_a, k_b',
    );

    expect(mockCreate).toHaveBeenCalledOnce();
    const body = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({
      title: 'Hiring trends',
      authorIds: ['k_a', 'k_b'],
    });
    // Unset options must not leak into the request body.
    expect(body).not.toHaveProperty('slug');
    expect(body).not.toHaveProperty('status');
  });

  it('forwards SEO and feature-image metadata flags into the create body', async () => {
    mockCreate.mockResolvedValue(ok({ id: 'k1', object: 'blog_post' }, 201));

    await run(
      'posts',
      'create',
      '--title',
      'Hiring trends',
      '--seo-title',
      'Hiring trends in 2026',
      '--seo-description',
      'What the data says',
      '--canonical-url',
      'https://example.com/canonical',
      '--feature-image-alt',
      'A team collaborating',
      '--feature-image-caption',
      'Photo by Cavuno',
    );

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate.mock.calls[0]![0]).toEqual({
      title: 'Hiring trends',
      seoTitle: 'Hiring trends in 2026',
      seoDescription: 'What the data says',
      canonicalUrl: 'https://example.com/canonical',
      featureImageAlt: 'A team collaborating',
      featureImageCaption: 'Photo by Cavuno',
    });
  });

  it('forwards SEO and feature-image metadata flags into the update body', async () => {
    mockUpdate.mockResolvedValue(ok({ id: 'k1', object: 'blog_post' }));

    await run(
      'posts',
      'update',
      'k1updateme',
      '--seo-title',
      'Updated SEO title',
      '--canonical-url',
      'https://example.com/new',
      '--feature-image-caption',
      'New caption',
    );

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdate.mock.calls[0]![0]).toBe('k1updateme');
    expect(mockUpdate.mock.calls[0]![1]).toEqual({
      seoTitle: 'Updated SEO title',
      canonicalUrl: 'https://example.com/new',
      featureImageCaption: 'New caption',
    });
  });

  it('routes the publish transition to client.publish with the post ID', async () => {
    mockPublish.mockResolvedValue(ok({ id: 'k1', status: 'published' }));

    await run('posts', 'publish', 'k1publishme');

    expect(mockPublish).toHaveBeenCalledWith('k1publishme');
    expect(mockUnpublish).not.toHaveBeenCalled();
    expect(mockToggleFeatured).not.toHaveBeenCalled();
  });

  it('creates an author through the authors group', async () => {
    mockAuthorsCreate.mockResolvedValue(
      ok({ id: 'k57', object: 'blog_author' }, 201),
    );

    await run('authors', 'create', '--name', 'Alex Chen');

    expect(mockAuthorsCreate).toHaveBeenCalledOnce();
    expect(mockAuthorsCreate.mock.calls[0]![0]).toEqual({ name: 'Alex Chen' });
  });

  it('creates a tag through the tags group', async () => {
    mockTagsCreate.mockResolvedValue(
      ok({ id: 'kn7', object: 'blog_tag' }, 201),
    );

    await run('tags', 'create', '--name', 'Hiring', '--visibility', 'internal');

    expect(mockTagsCreate).toHaveBeenCalledOnce();
    expect(mockTagsCreate.mock.calls[0]![0]).toEqual({
      name: 'Hiring',
      visibility: 'internal',
    });
  });

  it('surfaces a v1 error envelope as a CliError with the mapped exit code', async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'blog_post_not_found' } },
      response: new Response(null, { status: 404 }),
    });

    await expect(run('posts', 'get', 'k_missing')).rejects.toMatchObject({
      // fromApiError maps blog_post_not_found → exit 4.
      exitCode: 4,
    });
    await expect(run('posts', 'get', 'k_missing')).rejects.toBeInstanceOf(
      CliError,
    );
  });

  it.each([
    ['posts', () => mockRemove],
    ['authors', () => mockAuthorsDelete],
    ['tags', () => mockTagsDelete],
  ] as const)(
    '%s delete refuses without --yes when non-interactive (exit 2)',
    async (group, mock) => {
      await expect(run(group, 'delete', 'k97')).rejects.toMatchObject({
        exitCode: 2,
      });
      expect(mock()).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['posts', () => mockRemove],
    ['authors', () => mockAuthorsDelete],
    ['tags', () => mockTagsDelete],
  ] as const)('%s delete calls the API with --yes', async (group, mock) => {
    mock().mockResolvedValue(ok(undefined, 204));
    await run(group, 'delete', 'k97', '--yes');
    expect(mock()).toHaveBeenCalledWith('k97');
  });
});
