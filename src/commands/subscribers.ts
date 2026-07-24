import { Command } from 'commander';

import { createSubscribersClient } from '../api/subscribers.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { fromApiError } from '../lib/error.js';
import {
  resolveIdempotency,
  type IdempotencyOptions,
  withIdempotencyOption,
} from '../lib/idempotency.js';
import { print, type OutputFormat } from '../lib/output.js';
import { printOrWait, withWaitOption, type WaitOptions } from '../lib/wait.js';

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createSubscribersClient({
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

const listExtractor = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

function parseLimit(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    console.error(`--limit: expected an integer, got ${raw}`);
    process.exit(2);
  }
  if (n < 1 || n > 100) {
    console.error(`--limit: expected an integer from 1 to 100, got ${raw}`);
    process.exit(2);
  }
  return n;
}

function parseExportFormat(raw: string): 'csv' | 'json' {
  if (raw !== 'csv' && raw !== 'json') {
    console.error(`--export-format: expected "csv" or "json", got ${raw}`);
    process.exit(2);
  }
  return raw;
}

export function registerSubscribersCommand(root: Command): void {
  const subscribers = root
    .command('subscribers')
    .description('Manage alert subscribers for the authenticated account.');

  annotate(
    subscribers
      .command('list')
      .description('List subscribers (paginated).')
      .option('--search <query>', 'Case-insensitive substring match on email')
      .option(
        '--status <status>',
        'Filter by lifecycle status: confirmed | unconfirmed | unsubscribed | waitlisted',
      )
      .option('--limit <n>', 'Page size 1-100 (default 50)', parseLimit)
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          search?: string;
          status?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          await client.list({
            ...(opts.search !== undefined && { search: opts.search }),
            ...(opts.status !== undefined && {
              status: opts.status as
                | 'confirmed'
                | 'unconfirmed'
                | 'unsubscribed'
                | 'waitlisted',
            }),
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format, listExtractor);
      }),
    {
      mapsTo: 'GET /v1/subscribers',
      examples: [
        'cavuno subscribers list',
        'cavuno subscribers list --status confirmed --search alice --limit 20',
      ],
    },
  );

  annotate(
    subscribers
      .command('get')
      .description('Fetch a single subscriber by ID (with alerts inline).')
      .argument('<id>', 'Subscriber ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/subscribers/:id',
      examples: ['cavuno subscribers get sub_123'],
    },
  );

  annotate(
    subscribers
      .command('count')
      .description('Count confirmed subscribers for the account.')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.count());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/subscribers/count',
      examples: ['cavuno subscribers count'],
    },
  );

  annotate(
    subscribers
      .command('alerts')
      .description("List a subscriber's alerts.")
      .argument('<id>', 'Subscriber ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.alerts(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format, listExtractor);
      }),
    {
      mapsTo: 'GET /v1/subscribers/:id/alerts',
      examples: ['cavuno subscribers alerts sub_123'],
    },
  );

  annotate(
    withIdempotencyOption(
      subscribers
        .command('unsubscribe')
        .description(
          'Admin-unsubscribe a subscriber (sets unsubscribedAt, deactivates alerts). Reversible with resubscribe.',
        )
        .argument('<id>', 'Subscriber ID'),
    ).action(async function (this: Command, id: string) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await client.unsubscribe(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: 'POST /v1/subscribers/:id/unsubscribe',
      examples: ['cavuno subscribers unsubscribe sub_123'],
    },
  );

  annotate(
    withIdempotencyOption(
      subscribers
        .command('resubscribe')
        .description(
          'Admin-resubscribe a previously unsubscribed subscriber (clears unsubscribedAt, reactivates alerts).',
        )
        .argument('<id>', 'Subscriber ID'),
    ).action(async function (this: Command, id: string) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(await client.resubscribe(id, resolveIdempotency(opts)));
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: 'POST /v1/subscribers/:id/resubscribe',
      examples: ['cavuno subscribers resubscribe sub_123'],
    },
  );

  annotate(
    withWaitOption(
      subscribers
        .command('export')
        .description(
          'Export subscribers. csv (default) starts an async operation whose result carries a downloadUrl; json returns an inline list capped at 10,000 rows.',
        )
        .option(
          '--export-format <format>',
          'Export format: csv (async, default) or json (inline, max 10,000 rows)',
          parseExportFormat,
          'csv',
        ),
    ).action(async function (this: Command) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<{ exportFormat: 'csv' | 'json' } & WaitOptions>();
      const r = unwrap(await client.export({ format: opts.exportFormat }));
      if (r.error) throw fromApiError(r.error, r.response);

      if (opts.exportFormat === 'json') {
        print(r.data, format, listExtractor);
        return;
      }

      await printOrWait(this, r, opts);
    }),
    {
      mapsTo: 'GET /v1/subscribers/export',
      examples: [
        'cavuno subscribers export --export-format csv --wait',
        'cavuno subscribers export --export-format json',
      ],
    },
  );

  annotate(
    withWaitOption(
      withIdempotencyOption(
        subscribers
          .command('import')
          .description(
            'Bulk-import subscribers from a CSV file (async). Imported subscribers stay unconfirmed until they complete opt-in.',
          )
          .argument(
            '<file>',
            'Path to the CSV file (header row with an email column)',
          )
          .option(
            '--no-send-confirmation',
            'Skip the double-opt-in confirmation email',
          ),
      ),
    ).action(async function (this: Command, filePath: string) {
      const client = getClient(this);
      const opts = this.opts<
        { sendConfirmation: boolean } & IdempotencyOptions & WaitOptions
      >();

      const buffer = await readFile(filePath);
      const file = new Blob([buffer], { type: 'text/csv' });

      const r = unwrap(
        await client.import(
          {
            file,
            fileName: basename(filePath),
            sendConfirmation: opts.sendConfirmation,
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      await printOrWait(this, r, opts);
    }),
    {
      mapsTo: 'POST /v1/subscribers/import',
      examples: [
        'cavuno subscribers import ./subscribers.csv --wait',
        'cavuno subscribers import ./subscribers.csv --no-send-confirmation',
      ],
    },
  );
}
