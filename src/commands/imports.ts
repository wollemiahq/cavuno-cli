import { Command } from 'commander';

import {
  type ConfirmImportBody,
  createImportsClient,
} from '../api/imports.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import {
  resolveIdempotency,
  type IdempotencyOptions,
  withIdempotencyOption,
} from '../lib/idempotency.js';
import { print, type OutputFormat } from '../lib/output.js';
import { printOrWait, type WaitOptions, withWaitOption } from '../lib/wait.js';

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createImportsClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

function parseLimit(flag: string) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      console.error(`${flag}: expected an integer, got ${raw}`);
      process.exit(2);
    }
    if (n < 1 || n > 50) {
      console.error(`${flag}: expected an integer from 1 to 50, got ${raw}`);
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

const listExtractor = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

export function registerImportsCommand(root: Command): void {
  const imports = root
    .command('imports')
    .description('Bulk-load jobs from CSV files (upload → confirm → execute).');

  annotate(
    imports
      .command('list')
      .description('List import batches (paginated, most recent first).')
      .option(
        '--status <status>',
        'Filter by status (pending|processing|completed|partial|failed)',
      )
      .option('--from <iso>', 'Only batches created at or after this ISO date')
      .option('--to <iso>', 'Only batches created at or before this ISO date')
      .option(
        '--limit <n>',
        'Page size 1-50 (default 50)',
        parseLimit('--limit'),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const opts = this.opts<{
          status?:
            | 'pending'
            | 'processing'
            | 'completed'
            | 'partial'
            | 'failed';
          from?: string;
          to?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          await getClient(this).list({
            ...(opts.status !== undefined && { status: opts.status }),
            ...(opts.from !== undefined && { from: opts.from }),
            ...(opts.to !== undefined && { to: opts.to }),
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listExtractor);
      }),
    {
      mapsTo: 'GET /v1/imports',
      examples: [
        'cavuno imports list',
        'cavuno imports list --status completed --limit 10',
      ],
    },
  );

  annotate(
    imports
      .command('get')
      .description('Fetch one import batch (status, errors, proposed mapping).')
      .argument('<id>', 'Import batch ID')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/imports/:id',
      examples: ['cavuno imports get imports_k25abc'],
    },
  );

  annotate(
    withWaitOption(
      withIdempotencyOption(
        imports
          .command('create')
          .description(
            'Upload a CSV and start discovery. Returns an imports.parse operation to poll.',
          )
          .argument('<file>', 'Path to the local .csv file to upload'),
      ),
    ).action(async function (this: Command, filePath: string) {
      const opts = this.opts<IdempotencyOptions & WaitOptions>();

      const buffer = await readFile(filePath);
      const file = new Blob([buffer], { type: 'text/csv' });

      const r = unwrap(
        await getClient(this).create(
          { file, fileName: basename(filePath), sourceFormat: 'csv' },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      await printOrWait(this, r, opts);
    }),
    {
      mapsTo: 'POST /v1/imports',
      examples: [
        'cavuno imports create ./jobs.csv',
        'cavuno imports create ./jobs.csv --wait',
      ],
    },
  );

  annotate(
    withWaitOption(
      withIdempotencyOption(
        imports
          .command('confirm')
          .description(
            'Confirm the mapping and start execution. Returns an imports.confirm operation to poll.',
          )
          .argument('<id>', 'Import batch ID')
          .option(
            '--inline-mapping <json>',
            'A first-time or revised mapping as a JSON string. Omit to use the batch-attached mapping.',
          ),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & WaitOptions & { inlineMapping?: string }
      >();

      let body: ConfirmImportBody = {};
      if (opts.inlineMapping !== undefined) {
        let inlineMapping: unknown;
        try {
          inlineMapping = JSON.parse(opts.inlineMapping);
        } catch {
          console.error('--inline-mapping: value is not valid JSON');
          process.exit(2);
        }
        body = { inlineMapping } as ConfirmImportBody;
      }

      const r = unwrap(
        await getClient(this).confirm(id, body, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      await printOrWait(this, r, opts);
    }),
    {
      mapsTo: 'POST /v1/imports/:id/confirm',
      examples: [
        'cavuno imports confirm imports_k25abc',
        'cavuno imports confirm imports_k25abc --wait',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      imports
        .command('cancel')
        .description(
          'Cancel a pending or running import batch (cooperative — rows already written remain).',
        )
        .argument('<id>', 'Import batch ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).cancel(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/imports/:id/cancel',
      examples: ['cavuno imports cancel imports_k25abc'],
    },
  );

  annotate(
    imports
      .command('quota')
      .description("Show the account's daily import usage and reset boundary.")
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).quota());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/imports/quota',
      examples: ['cavuno imports quota'],
    },
  );
}
