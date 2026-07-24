import { Command } from 'commander';

import { createBlogClient } from '../api/blog.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { readBatchBody } from '../lib/batch-body.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(cmd: Command) {
  const opts = cmd.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createBlogClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(cmd: Command): OutputFormat {
  return cmd.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

const toRows = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

const csv = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function registerBlogCommand(root: Command): void {
  const blog = root
    .command('blog')
    .description('Manage blog posts, authors, and tags.');

  // ── Posts ────────────────────────────────────────────────────────────────
  const posts = blog.command('posts').description('Manage blog posts.');

  annotate(
    posts
      .command('list')
      .description('List posts (paginated).')
      .option(
        '--status <status>',
        'Filter by status (draft|scheduled|published)',
      )
      .option('--limit <n>', 'Page size 1-100', (v) => parseInt(v, 10))
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const o = this.opts<{
          status?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(await client.list(o));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), toRows);
      }),
    {
      mapsTo: 'GET /v1/blog/posts',
      examples: ['cavuno blog posts list --status draft'],
    },
  );

  annotate(
    posts
      .command('get')
      .description('Fetch a post by ID (includes html).')
      .argument('<id>', 'Post ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const r = unwrap(await client.get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/blog/posts/:id',
      examples: ['cavuno blog posts get k97...'],
    },
  );

  annotate(
    posts
      .command('create')
      .description('Create a post (defaults to draft).')
      .requiredOption('--title <title>', 'Post title (required)')
      .option('--slug <slug>', 'URL slug; auto-derived from --title')
      .option('--html <html>', 'Rich-text HTML body (sanitized server-side)')
      .option('--custom-excerpt <text>', 'Excerpt')
      .option('--status <status>', 'draft|scheduled|published')
      .option('--published-at <iso>', 'ISO datetime (required for scheduled)')
      .option('--featured', 'Mark as featured')
      .option('--author-ids <ids>', 'Comma-separated author IDs', csv)
      .option('--tag-ids <ids>', 'Comma-separated tag IDs', csv)
      .option('--cover-storage-id <id>', 'Cover image storage ID')
      .option('--og-image-storage-id <id>', 'OG image storage ID')
      .option('--feature-image-alt <text>', 'Feature image alt text')
      .option('--feature-image-caption <text>', 'Feature image caption')
      .option('--seo-title <text>', 'SEO meta title')
      .option('--seo-description <text>', 'SEO meta description')
      .option('--canonical-url <url>', 'Canonical URL')
      .action(async function (this: Command) {
        const client = getClient(this);
        const o = this.opts<Record<string, unknown>>();
        const body: Record<string, unknown> = { title: o.title };
        for (const k of [
          'slug',
          'html',
          'customExcerpt',
          'status',
          'publishedAt',
          'featured',
          'authorIds',
          'tagIds',
          'coverStorageId',
          'ogImageStorageId',
          'featureImageAlt',
          'featureImageCaption',
          'seoTitle',
          'seoDescription',
          'canonicalUrl',
        ]) {
          if (o[k] !== undefined) body[k] = o[k];
        }
        const r = unwrap(await client.create(body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/blog/posts',
      examples: ['cavuno blog posts create --title "Hiring trends"'],
    },
  );

  annotate(
    posts
      .command('update')
      .description(
        'Update a post (partial). Status changes use publish/unpublish.',
      )
      .argument('<id>', 'Post ID')
      .option('--title <title>')
      .option('--slug <slug>')
      .option('--html <html>')
      .option('--custom-excerpt <text>')
      .option('--featured')
      .option('--author-ids <ids>', 'Comma-separated author IDs', csv)
      .option('--tag-ids <ids>', 'Comma-separated tag IDs', csv)
      .option('--feature-image-alt <text>', 'Feature image alt text')
      .option('--feature-image-caption <text>', 'Feature image caption')
      .option('--seo-title <text>', 'SEO meta title')
      .option('--seo-description <text>', 'SEO meta description')
      .option('--canonical-url <url>', 'Canonical URL')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const o = this.opts<Record<string, unknown>>();
        const body: Record<string, unknown> = {};
        for (const k of [
          'title',
          'slug',
          'html',
          'customExcerpt',
          'featured',
          'authorIds',
          'tagIds',
          'featureImageAlt',
          'featureImageCaption',
          'seoTitle',
          'seoDescription',
          'canonicalUrl',
        ]) {
          if (o[k] !== undefined) body[k] = o[k];
        }
        const r = unwrap(await client.update(id, body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PATCH /v1/blog/posts/:id',
      examples: ['cavuno blog posts update k97... --title "New"'],
    },
  );

  for (const [name, method, verb] of [
    ['publish', 'publish', 'Publish'],
    ['unpublish', 'unpublish', 'Unpublish'],
    ['toggle-featured', 'toggleFeatured', 'Toggle featured on'],
  ] as const) {
    annotate(
      posts
        .command(name)
        .description(`${verb} a post.`)
        .argument('<id>', 'Post ID')
        .action(async function (this: Command, id: string) {
          const client = getClient(this);
          const r = unwrap(
            await (client[method] as (i: string) => Promise<unknown>)(id),
          );
          if (r.error) throw fromApiError(r.error, r.response);
          print(r.data, getFormat(this));
        }),
      {
        mapsTo: `POST /v1/blog/posts/:id/${name}`,
        examples: [`cavuno blog posts ${name} k97...`],
      },
    );
  }

  annotate(
    posts
      .command('search')
      .description('Title search across all statuses (includes drafts).')
      .argument('<query>', 'Search query')
      .option('--status <status>', 'Narrow to one status')
      .option('--limit <n>', 'Page size 1-100', (v) => parseInt(v, 10))
      .action(async function (this: Command, query: string) {
        const client = getClient(this);
        const o = this.opts<{ status?: string; limit?: number }>();
        const r = unwrap(
          await client.search({
            query,
            ...(o.status !== undefined && { status: o.status }),
            ...(o.limit !== undefined && { limit: o.limit }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), toRows);
      }),
    {
      mapsTo: 'POST /v1/blog/posts/search',
      examples: ['cavuno blog posts search "hiring"'],
    },
  );

  annotate(
    posts
      .command('batch')
      .description(
        'Run a batch of blog post operations. Pass JSON via --file or stdin. Exit 0 on HTTP 200 even if some rows fail — inspect the body.',
      )
      .option('--file <path>', 'JSON file body (otherwise read stdin)')
      .action(async function (this: Command) {
        const client = getClient(this);
        const o = this.opts<{ file?: string }>();
        const body = await readBatchBody(o.file);
        const r = unwrap(await client.batch(body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/blog/posts/batch',
      examples: ['cavuno blog posts batch --file ops.json'],
    },
  );

  annotate(
    withYesOption(
      posts
        .command('delete')
        .description('Delete a post.')
        .argument('<id>', 'Post ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete blog post ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(await client.remove(id));
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/blog/posts/:id',
      examples: ['cavuno blog posts delete k97... --yes'],
    },
  );

  // ── Authors ────────────────────────────────────────────────────────────────
  const authors = blog.command('authors').description('Manage blog authors.');

  annotate(
    authors
      .command('list')
      .description('List authors.')
      .option('--limit <n>', 'Page size 1-100', (v) => parseInt(v, 10))
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const r = unwrap(await client.authorsList(this.opts()));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), toRows);
      }),
    { mapsTo: 'GET /v1/blog/authors', examples: ['cavuno blog authors list'] },
  );

  annotate(
    authors
      .command('get')
      .description('Fetch an author by ID.')
      .argument('<id>', 'Author ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const r = unwrap(await client.authorsGet(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/blog/authors/:id',
      examples: ['cavuno blog authors get k57...'],
    },
  );

  annotate(
    authors
      .command('create')
      .description('Create an author.')
      .requiredOption('--name <name>', 'Author name (required)')
      .option('--slug <slug>')
      .option('--bio <bio>')
      .option('--email <email>')
      .option('--website-url <url>')
      .option('--twitter-url <url>')
      .option('--linkedin-url <url>')
      .option('--github-url <url>')
      .action(async function (this: Command) {
        const client = getClient(this);
        const o = this.opts<Record<string, unknown>>();
        const body: Record<string, unknown> = { name: o.name };
        for (const k of [
          'slug',
          'bio',
          'email',
          'websiteUrl',
          'twitterUrl',
          'linkedinUrl',
          'githubUrl',
        ]) {
          if (o[k] !== undefined) body[k] = o[k];
        }
        const r = unwrap(await client.authorsCreate(body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/blog/authors',
      examples: ['cavuno blog authors create --name "Alex Chen"'],
    },
  );

  annotate(
    authors
      .command('update')
      .description('Update an author (partial).')
      .argument('<id>', 'Author ID')
      .option('--name <name>')
      .option('--slug <slug>')
      .option('--bio <bio>')
      .option('--email <email>')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const o = this.opts<Record<string, unknown>>();
        const body: Record<string, unknown> = {};
        for (const k of ['name', 'slug', 'bio', 'email']) {
          if (o[k] !== undefined) body[k] = o[k];
        }
        const r = unwrap(await client.authorsUpdate(id, body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PATCH /v1/blog/authors/:id',
      examples: ['cavuno blog authors update k57... --bio "…"'],
    },
  );

  annotate(
    withYesOption(
      authors
        .command('delete')
        .description('Delete an author (posts keep the stale ID).')
        .argument('<id>', 'Author ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete blog author ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(await client.authorsDelete(id));
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/blog/authors/:id',
      examples: ['cavuno blog authors delete k57... --yes'],
    },
  );

  // ── Tags ────────────────────────────────────────────────────────────────
  const tags = blog.command('tags').description('Manage blog tags.');

  annotate(
    tags
      .command('list')
      .description('List tags.')
      .option('--limit <n>', 'Page size 1-100', (v) => parseInt(v, 10))
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const r = unwrap(await client.tagsList(this.opts()));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), toRows);
      }),
    { mapsTo: 'GET /v1/blog/tags', examples: ['cavuno blog tags list'] },
  );

  annotate(
    tags
      .command('get')
      .description('Fetch a tag by ID.')
      .argument('<id>', 'Tag ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const r = unwrap(await client.tagsGet(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/blog/tags/:id',
      examples: ['cavuno blog tags get kn7...'],
    },
  );

  annotate(
    tags
      .command('create')
      .description('Create a tag.')
      .requiredOption('--name <name>', 'Tag name (required)')
      .option('--slug <slug>')
      .option('--description <text>')
      .option('--visibility <vis>', 'public|internal')
      .action(async function (this: Command) {
        const client = getClient(this);
        const o = this.opts<Record<string, unknown>>();
        const body: Record<string, unknown> = { name: o.name };
        for (const k of ['slug', 'description', 'visibility']) {
          if (o[k] !== undefined) body[k] = o[k];
        }
        const r = unwrap(await client.tagsCreate(body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/blog/tags',
      examples: ['cavuno blog tags create --name "Hiring"'],
    },
  );

  annotate(
    tags
      .command('update')
      .description('Update a tag (partial).')
      .argument('<id>', 'Tag ID')
      .option('--name <name>')
      .option('--slug <slug>')
      .option('--description <text>')
      .option('--visibility <vis>')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const o = this.opts<Record<string, unknown>>();
        const body: Record<string, unknown> = {};
        for (const k of ['name', 'slug', 'description', 'visibility']) {
          if (o[k] !== undefined) body[k] = o[k];
        }
        const r = unwrap(await client.tagsUpdate(id, body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PATCH /v1/blog/tags/:id',
      examples: ['cavuno blog tags update kn7... --name "X"'],
    },
  );

  annotate(
    withYesOption(
      tags
        .command('delete')
        .description('Delete a tag (posts keep the stale ID).')
        .argument('<id>', 'Tag ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete blog tag ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(await client.tagsDelete(id));
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/blog/tags/:id',
      examples: ['cavuno blog tags delete kn7... --yes'],
    },
  );
}
