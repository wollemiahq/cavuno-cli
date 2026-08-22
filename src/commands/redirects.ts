import { Command } from 'commander';

import { createRedirectsClient } from '../api/redirects.js';
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

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createRedirectsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
}

function parseIntArg(flag: string, min: number, max: number) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      console.error(`${flag}: expected an integer, got ${raw}`);
      process.exit(2);
    }
    if (n < min || n > max) {
      console.error(
        `${flag}: expected an integer from ${min} to ${max}, got ${raw}`,
      );
      process.exit(2);
    }
    return n;
  };
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

function newIdempotencyKey(): string {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function registerRedirectsCommand(root: Command): void {
  const redirects = root
    .command('redirects')
    .description('Manage board redirect rules for the authenticated account.');

  annotate(
    redirects
      .command('list')
      .description('List redirect rules.')
      .option('--search <prefix>', 'Prefix match on fromPath')
      .option(
        '--limit <n>',
        'Page size 1-100 (default 50)',
        parseIntArg('--limit', 1, 100),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          search?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(await client.list(opts));
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          format,
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/redirects',
      examples: [
        'cavuno redirects list',
        'cavuno redirects list --search /old',
      ],
    },
  );

  annotate(
    redirects
      .command('create')
      .description('Create a redirect rule.')
      .argument('<fromPath>', 'Source path, for example /old-careers')
      .argument('<toPath>', 'Destination path, for example /jobs')
      .option(
        '--status-code <code>',
        'HTTP status code: 301 or 302 (default 301)',
        (raw) => {
          const n = Number(raw);
          if (n !== 301 && n !== 302) {
            console.error('--status-code: expected 301 or 302');
            process.exit(2);
          }
          return n as 301 | 302;
        },
      )
      .action(async function (this: Command, fromPath: string, toPath: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ statusCode?: 301 | 302 }>();
        const r = unwrap(
          await client.create(
            {
              fromPath,
              toPath,
              statusCode: opts.statusCode ?? 301,
            },
            { idempotencyKey: newIdempotencyKey() },
          ),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/redirects',
      examples: [
        'cavuno redirects create /old-careers /jobs',
        'cavuno redirects create /old /new --status-code 302',
      ],
    },
  );

  annotate(
    redirects
      .command('update')
      .description('Update a redirect rule.')
      .argument('<id>', 'Redirect ID')
      .option('--from-path <path>', 'New source path')
      .option('--to-path <path>', 'New destination path')
      .option('--status-code <code>', 'HTTP status code: 301 or 302', (raw) => {
        const n = Number(raw);
        if (n !== 301 && n !== 302) {
          console.error('--status-code: expected 301 or 302');
          process.exit(2);
        }
        return n as 301 | 302;
      })
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          fromPath?: string;
          toPath?: string;
          statusCode?: 301 | 302;
        }>();
        const body: {
          fromPath?: string;
          toPath?: string;
          statusCode?: 301 | 302;
        } = {};
        if (opts.fromPath !== undefined) body.fromPath = opts.fromPath;
        if (opts.toPath !== undefined) body.toPath = opts.toPath;
        if (opts.statusCode !== undefined) body.statusCode = opts.statusCode;
        const r = unwrap(
          await client.update(id, body, {
            idempotencyKey: newIdempotencyKey(),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'PATCH /v1/redirects/:id',
      examples: [
        'cavuno redirects update k200abc --to-path /jobs',
        'cavuno redirects update k200abc --from-path /old --status-code 302',
      ],
    },
  );

  annotate(
    withYesOption(
      redirects
        .command('remove')
        .description('Delete a redirect rule.')
        .argument('<id>', 'Redirect ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete redirect ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(
        await client.remove(id, { idempotencyKey: newIdempotencyKey() }),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/redirects/:id',
      examples: ['cavuno redirects remove k200abc --yes'],
    },
  );

  annotate(
    redirects
      .command('batch')
      .description(
        'Run a batch of redirect operations. Pass JSON via --file or stdin. Exit 0 on HTTP 200 even if some rows fail — inspect the body.',
      )
      .option('--file <path>', 'JSON file body (otherwise read stdin)')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ file?: string }>();
        const body = await readBatchBody(opts.file);
        const r = unwrap(await client.batch(body as never));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/redirects/batch',
      examples: ['cavuno redirects batch --file ops.json'],
    },
  );
}
