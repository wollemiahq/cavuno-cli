import { Command } from 'commander';

import {
  createTransactionsClient,
  type TransactionListQuery,
} from '../api/transactions.js';
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
  return createTransactionsClient({
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

export function registerTransactionsCommand(root: Command): void {
  const cmd = root
    .command('transactions')
    .description(
      'Read the board transactions ledger (billing.read). List + get only.',
    );

  annotate(
    cmd
      .command('list')
      .description('List transactions (date-desc, or relevance when --search).')
      .option(
        '--limit <n>',
        'Page size 1-100 (default 50)',
        parseIntArg('--limit', 1, 100),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .option('--status <status>', 'Filter: paid | open | void | uncollectible')
      .option('--kind <kind>', 'Filter: card_post | invoice | subscription')
      .option(
        '--search <q>',
        'Full-text search (mutually exclusive with --order-id / --subscription-id)',
      )
      .option(
        '--order-id <id>',
        'Filter by jobOrders id (mutually exclusive with --search / --subscription-id)',
      )
      .option(
        '--subscription-id <id>',
        'Filter by employerSubscriptions id (mutually exclusive with --search / --order-id)',
      )
      .action(async function (this: Command) {
        const opts = this.opts<{
          limit?: number;
          cursor?: string;
          status?: string;
          kind?: string;
          search?: string;
          orderId?: string;
          subscriptionId?: string;
        }>();
        // Flat pass-through; the server validates enums/combos. One cast at
        // the boundary, matching the employer-subscriptions command.
        const r = unwrap(
          await getClient(this).list(opts as TransactionListQuery),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          getFormat(this),
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/transactions',
      examples: [
        'cavuno transactions list',
        'cavuno transactions list --status paid --kind invoice',
        'cavuno transactions list --search "Acme"',
      ],
    },
  );

  annotate(
    cmd
      .command('get')
      .description('Get one transaction by id.')
      .argument('<id>', 'Transaction id')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/transactions/:id',
      examples: ['cavuno transactions get tx_…'],
    },
  );
}
