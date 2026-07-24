import { Command } from 'commander';

import {
  createPaywallClient,
  type ListCandidatePaywallSubscriptionsQuery,
} from '../api/paywall.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { fromApiError } from '../lib/error.js';
import {
  resolveIdempotency,
  withIdempotencyOption,
} from '../lib/idempotency.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createPaywallClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

/**
 * Atomic candidate-access paywall + read-only subscriptions.
 */
export function registerPaywallCommand(root: Command): void {
  const paywall = root
    .command('paywall')
    .description(
      'Manage the candidate-access paywall (atomic configuration + six offers) and list subscriptions.',
    );

  annotate(
    paywall
      .command('get')
      .description(
        'Show the atomic candidate paywall configuration and six fixed offers.',
      )
      .action(async function (this: Command) {
        const { data, error, response } = await getClient(this).get();
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/paywall',
      examples: ['cavuno paywall get'],
    },
  );

  annotate(
    withIdempotencyOption(
      paywall
        .command('replace')
        .description(
          'Atomically replace the candidate paywall configuration and all six offers. Requires --idempotency-key (or CAVUNO_IDEMPOTENCY_KEY).',
        )
        .requiredOption(
          '--body <json>',
          'Full candidate_paywall JSON body (complete resource replace)',
        )
        .action(async function (this: Command) {
          const opts = this.opts<{ body: string; idempotencyKey?: string }>();
          let body: unknown;
          try {
            body = JSON.parse(opts.body);
          } catch {
            console.error('--body must be valid JSON');
            process.exit(2);
          }
          const { data, error, response } = await getClient(this).replace(
            body as never,
            resolveIdempotency(opts),
          );
          if (error) throw fromApiError(error, response);
          print(data, getFormat(this));
        }),
    ),
    {
      mapsTo: 'PUT /v1/paywall',
      examples: [
        'cavuno paywall replace --body \'{"enabled":false,"previewCount":5,...}\' --idempotency-key $(uuidgen)',
      ],
    },
  );

  annotate(
    paywall
      .command('subscriptions')
      .description('List candidate paywall subscriptions (read-only grants).')
      .option('--status <status>', 'Filter by subscription status')
      .option('--kind <kind>', 'Filter by kind: recurring | lifetime')
      .option('--limit <n>', 'Page size 1–100', (v) => Number(v))
      .option('--cursor <cursor>', 'Pagination cursor from a previous response')
      .action(async function (this: Command) {
        const opts = this.opts<{
          status?: string;
          kind?: string;
          limit?: number;
          cursor?: string;
        }>();
        const { data, error, response } = await getClient(
          this,
        ).listSubscriptions({
          status:
            opts.status as ListCandidatePaywallSubscriptionsQuery['status'],
          kind: opts.kind as 'recurring' | 'lifetime' | undefined,
          limit: opts.limit,
          cursor: opts.cursor,
        });
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/paywall/subscriptions',
      examples: [
        'cavuno paywall subscriptions',
        'cavuno paywall subscriptions --status active --kind recurring',
      ],
    },
  );
}
