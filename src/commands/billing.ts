import { Command } from 'commander';

import { createBillingClient } from '../api/billing.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { fromApiError } from '../lib/error.js';
import {
  resolveIdempotency,
  type IdempotencyOptions,
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
  return createBillingClient({
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

const PLAN_KEYS = [
  'starter',
  'basic',
  'grow',
  'advanced',
  'enterprise',
] as const;
const INTERVALS = ['monthly', 'annual'] as const;

type PlanKey = (typeof PLAN_KEYS)[number];
type Interval = (typeof INTERVALS)[number];

function parsePlanKey(raw: string): PlanKey {
  if ((PLAN_KEYS as readonly string[]).includes(raw)) {
    return raw as PlanKey;
  }
  console.error(`--plan: expected one of ${PLAN_KEYS.join('|')}, got ${raw}`);
  process.exit(2);
}

function parseInterval(raw: string): Interval {
  if ((INTERVALS as readonly string[]).includes(raw)) {
    return raw as Interval;
  }
  console.error(
    `--interval: expected one of ${INTERVALS.join('|')}, got ${raw}`,
  );
  process.exit(2);
}

/**
 * Billing status + money-path commands.
 */
export function registerBillingCommand(root: Command): void {
  const billing = root
    .command('billing')
    .description(
      'Read account billing status and manage the platform subscription.',
    );

  annotate(
    billing
      .command('subscription')
      .description("Show the account's platform subscription.")
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).getSubscription());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/billing/subscription',
      examples: ['cavuno billing subscription'],
    },
  );

  annotate(
    billing
      .command('connect')
      .description("Show the Board's payment connection readiness.")
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).getConnect());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/billing/connect',
      examples: ['cavuno billing connect'],
    },
  );

  annotate(
    billing
      .command('checkout')
      .description('Create a hosted checkout URL for a target plan.')
      .requiredOption(
        '--plan <key>',
        `Plan key (${PLAN_KEYS.join('|')})`,
        parsePlanKey,
      )
      .option(
        '--interval <interval>',
        `Billing interval (${INTERVALS.join('|')}; default monthly)`,
        parseInterval,
      )
      .action(async function (this: Command) {
        const opts = this.opts<{ plan: PlanKey; interval?: Interval }>();
        const r = unwrap(
          await getClient(this).postCheckout({
            planKey: opts.plan,
            ...(opts.interval ? { interval: opts.interval } : {}),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/billing/checkout',
      examples: [
        'cavuno billing checkout --plan starter',
        'cavuno billing checkout --plan basic --interval annual',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      billing
        .command('upgrade')
        .description(
          'Create a hosted human-confirmation URL for a plan change.',
        )
        .requiredOption(
          '--plan <key>',
          `Target plan key (${PLAN_KEYS.join('|')})`,
          parsePlanKey,
        )
        .option(
          '--interval <interval>',
          `Billing interval (${INTERVALS.join('|')}; default monthly)`,
          parseInterval,
        ),
    ).action(async function (this: Command) {
      const opts = this.opts<
        { plan: PlanKey; interval?: Interval } & IdempotencyOptions
      >();
      const r = unwrap(
        await getClient(this).postUpgrade(
          {
            planKey: opts.plan,
            ...(opts.interval ? { interval: opts.interval } : {}),
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/billing/upgrade',
      examples: [
        'cavuno billing upgrade --plan basic',
        'cavuno billing upgrade --plan grow --interval annual',
      ],
    },
  );
}
