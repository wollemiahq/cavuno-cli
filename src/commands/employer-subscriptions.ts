import { Command } from 'commander';

import { createEmployerSubscriptionsClient } from '../api/employer-subscriptions.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createEmployerSubscriptionsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

function parseIntArg(flag: string, min: number, max: number) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      console.error(`${flag}: expected integer ${min}-${max}, got ${raw}`);
      process.exit(2);
    }
    return n;
  };
}

export function registerEmployerSubscriptionsCommand(root: Command): void {
  const cmd = root
    .command('employer-subscriptions')
    .description(
      'Read employer subscriptions on the tenant board (billing.read).',
    );

  annotate(
    cmd
      .command('list')
      .description('List employer subscriptions.')
      .option(
        '--limit <n>',
        'Page size 1-100 (default 50)',
        parseIntArg('--limit', 1, 100),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .option('--status <status>', 'Filter by status (active, canceled, …)')
      .option('--company-id <id>', 'Filter by company id')
      .action(async function (this: Command) {
        const opts = this.opts<{
          limit?: number;
          cursor?: string;
          status?: string;
          companyId?: string;
        }>();
        const r = unwrap(await getClient(this).list(opts));
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          getFormat(this),
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/employer-subscriptions',
      examples: [
        'cavuno employer-subscriptions list',
        'cavuno employer-subscriptions list --status active',
      ],
    },
  );

  annotate(
    cmd
      .command('get')
      .description('Get one employer subscription by id.')
      .argument('<id>', 'Employer subscription id')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/employer-subscriptions/:id',
      examples: ['cavuno employer-subscriptions get es_…'],
    },
  );
}
