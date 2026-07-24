import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { annotate } from '../lib/annotate.js';
import { buildManifest } from '../lib/manifest.js';

function makeCli() {
  const program = new Command();
  program
    .name('cavuno')
    .version('1.2.3')
    .option('--api-url <url>', 'Override base URL')
    .option('--format <format>', 'Output format', 'json');

  const jobs = program
    .command('jobs')
    .description('Manage jobs in the authenticated account.');

  annotate(
    jobs
      .command('list')
      .description('List jobs (paginated).')
      .option(
        '--status <status>',
        'Filter by status (draft|published|expired|archived)',
      )
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      ),
    {
      examples: ['cavuno jobs list --status published'],
      mapsTo: 'GET /v1/jobs',
    },
  );

  annotate(
    jobs
      .command('get')
      .description('Fetch a single job by ID.')
      .argument('<id>', 'Job ID'),
    {
      examples: ['cavuno jobs get k17abc...'],
      mapsTo: 'GET /v1/jobs/:id',
    },
  );

  jobs
    .command('create')
    .description('Create a draft job.')
    .requiredOption('--title <title>', 'Job title (required)');

  // Group that should be filtered out.
  program
    .command('settings')
    .description('Manage singleton board settings.')
    .command('get')
    .description('Fetch settings.');

  // Nested group (blog → posts → leaf commands) to exercise recursion.
  const blog = program.command('blog').description('Manage blog content.');
  const posts = blog.command('posts').description('Manage blog posts.');
  annotate(
    posts
      .command('create')
      .description('Create a post.')
      .requiredOption('--title <title>', 'Post title (required)')
      .option('--seo-title <text>', 'SEO meta title'),
    {
      examples: ['cavuno blog posts create --title "Hello"'],
      mapsTo: 'POST /v1/blog/posts',
    },
  );
  posts.command('list').description('List posts.');

  return program;
}

describe('buildManifest', () => {
  it('only emits groups in the allow-list', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });

    expect(m.groups.map((g) => g.name)).toEqual(['jobs']);
    expect(m.groups[0]!.commands.map((c) => c.name).sort()).toEqual([
      'create',
      'get',
      'list',
    ]);
  });

  it('captures group description', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });
    expect(m.groups[0]!.description).toBe(
      'Manage jobs in the authenticated account.',
    );
  });

  it('captures command name and description', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });
    const list = m.groups[0]!.commands.find((c) => c.name === 'list')!;
    expect(list.description).toBe('List jobs (paginated).');
  });

  it('captures arguments with required flag', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });
    const get = m.groups[0]!.commands.find((c) => c.name === 'get')!;
    expect(get.arguments).toEqual([
      { name: 'id', description: 'Job ID', required: true, variadic: false },
    ]);
  });

  it('captures options with flags, description, and required state', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });
    const list = m.groups[0]!.commands.find((c) => c.name === 'list')!;
    const status = list.options.find((o) => o.flags === '--status <status>');
    expect(status).toBeDefined();
    expect(status!.description).toContain('Filter by status');
    expect(status!.required).toBe(false);
  });

  it('marks requiredOption as required', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });
    const create = m.groups[0]!.commands.find((c) => c.name === 'create')!;
    const title = create.options.find((o) => o.flags === '--title <title>')!;
    expect(title.required).toBe(true);
  });

  it('captures examples and mapsTo from annotate()', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });
    const get = m.groups[0]!.commands.find((c) => c.name === 'get')!;
    expect(get.examples).toEqual(['cavuno jobs get k17abc...']);
    expect(get.mapsTo).toBe('GET /v1/jobs/:id');
  });

  it('renders the synopsis with the parent group prefix', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });
    const list = m.groups[0]!.commands.find((c) => c.name === 'list')!;
    expect(list.synopsis).toBe('cavuno jobs list [options]');

    const get = m.groups[0]!.commands.find((c) => c.name === 'get')!;
    expect(get.synopsis).toBe('cavuno jobs get <id>');
  });

  it('records the CLI version on the manifest root', () => {
    const m = buildManifest(makeCli(), { groups: ['jobs'] });
    expect(m.version).toBe('1.2.3');
  });

  it('flattens nested subgroups into compound command names', () => {
    const m = buildManifest(makeCli(), { groups: ['blog'] });
    expect(m.groups[0]!.commands.map((c) => c.name).sort()).toEqual([
      'posts create',
      'posts list',
    ]);
  });

  it('captures options, mapsTo, and examples on a nested leaf command', () => {
    const m = buildManifest(makeCli(), { groups: ['blog'] });
    const create = m.groups[0]!.commands.find(
      (c) => c.name === 'posts create',
    )!;
    expect(create.options.map((o) => o.flags).sort()).toEqual([
      '--seo-title <text>',
      '--title <title>',
    ]);
    expect(create.mapsTo).toBe('POST /v1/blog/posts');
    expect(create.examples).toEqual([
      'cavuno blog posts create --title "Hello"',
    ]);
  });

  it('builds the nested leaf synopsis with the full command path', () => {
    const m = buildManifest(makeCli(), { groups: ['blog'] });
    const create = m.groups[0]!.commands.find(
      (c) => c.name === 'posts create',
    )!;
    expect(create.synopsis).toBe('cavuno blog posts create [options]');
  });

  it('preserves the order of groups as listed in the allow-list', () => {
    // Add a usage command for ordering test.
    const program = makeCli();
    program
      .command('usage')
      .description('Inspect usage.')
      .command('get')
      .description('Show usage.');

    const m = buildManifest(program, { groups: ['usage', 'jobs'] });
    expect(m.groups.map((g) => g.name)).toEqual(['usage', 'jobs']);
  });
});
