import { Command } from 'commander';

import {
  createPlansClient,
  type SetPlanFeaturesBody,
} from '../api/plans.js';

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
  return createPlansClient({
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

function newIdempotencyKey(): string {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseIntArg(flag: string) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      console.error(`${flag}: expected an integer, got ${raw}`);
      process.exit(2);
    }
    return n;
  };
}

/**
 * Employer-plans CRUD. Plans a board operator sells to employers —
 * Connect-scoped prices. Distinct from `cavuno billing` (platform subscription).
 */
export function registerPlansCommand(root: Command): void {
  const plans = root
    .command('plans')
    .description(
      'Manage employer plans the account sells (pricing, features). Distinct from `billing` (your platform subscription).',
    );

  annotate(
    plans
      .command('list')
      .description('List employer plans for the authenticated account.')
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).list());
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          getFormat(this),
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/plans',
      examples: ['cavuno plans list'],
    },
  );

  annotate(
    plans
      .command('get')
      .description('Get one employer plan by id.')
      .argument('<id>', 'Plan id')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/plans/:id',
      examples: ['cavuno plans get plans_xxx'],
    },
  );

  annotate(
    plans
      .command('create')
      .description(
        'Create an employer plan (metadata only; set price separately).',
      )
      .requiredOption('--name <name>', 'Plan display name')
      .requiredOption(
        '--kind <kind>',
        'Plan kind: free | one_time | bundle | subscription',
      )
      .option('--description <text>', 'Plan description')
      .option('--billing-interval <interval>', 'month | year (subscription)')
      .option('--purpose <purpose>', 'job_posting | talent_access')
      .option('--public', 'List the plan publicly')
      .option('--recommended', 'Mark as recommended')
      .option(
        '--display-order <n>',
        'Display order integer',
        parseIntArg('--display-order'),
      )
      .action(async function (this: Command) {
        const opts = this.opts<{
          name: string;
          kind: 'free' | 'one_time' | 'bundle' | 'subscription';
          description?: string;
          billingInterval?: 'month' | 'year';
          purpose?: 'job_posting' | 'talent_access';
          public?: boolean;
          recommended?: boolean;
          displayOrder?: number;
        }>();
        const r = unwrap(
          await getClient(this).create(
            {
              name: opts.name,
              kind: opts.kind,
              ...(opts.description !== undefined
                ? { description: opts.description }
                : {}),
              ...(opts.billingInterval !== undefined
                ? { billingInterval: opts.billingInterval }
                : {}),
              ...(opts.purpose !== undefined ? { purpose: opts.purpose } : {}),
              ...(opts.public !== undefined ? { isPublic: opts.public } : {}),
              ...(opts.recommended !== undefined
                ? { isRecommended: opts.recommended }
                : {}),
              ...(opts.displayOrder !== undefined
                ? { displayOrder: opts.displayOrder }
                : {}),
            },
            { idempotencyKey: newIdempotencyKey() },
          ),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/plans',
      examples: [
        'cavuno plans create --name "Pro" --kind subscription --billing-interval month --public',
      ],
    },
  );

  annotate(
    plans
      .command('update')
      .description('Update plan metadata (archive with --archived).')
      .argument('<id>', 'Plan id')
      .option('--name <name>', 'New display name')
      .option('--description <text>', 'New description')
      .option('--public', 'Publish the plan')
      .option('--private', 'Unpublish the plan')
      .option('--recommended', 'Mark recommended')
      .option('--not-recommended', 'Clear recommended')
      .option('--archived', 'Archive the plan')
      .option('--unarchived', 'Unarchive the plan')
      .option(
        '--display-order <n>',
        'Display order integer',
        parseIntArg('--display-order'),
      )
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{
          name?: string;
          description?: string;
          public?: boolean;
          private?: boolean;
          recommended?: boolean;
          notRecommended?: boolean;
          archived?: boolean;
          unarchived?: boolean;
          displayOrder?: number;
        }>();
        const body: Record<string, unknown> = {};
        if (opts.name !== undefined) body.name = opts.name;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.public) body.isPublic = true;
        if (opts.private) body.isPublic = false;
        if (opts.recommended) body.isRecommended = true;
        if (opts.notRecommended) body.isRecommended = false;
        if (opts.archived) body.isArchived = true;
        if (opts.unarchived) body.isArchived = false;
        if (opts.displayOrder !== undefined)
          body.displayOrder = opts.displayOrder;

        const r = unwrap(
          await getClient(this).update(id, body as never, {
            idempotencyKey: newIdempotencyKey(),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PATCH /v1/plans/:id',
      examples: [
        'cavuno plans update plans_xxx --name "Pro+"',
        'cavuno plans update plans_xxx --archived',
      ],
    },
  );

  annotate(
    plans
      .command('set-price')
      .description(
        'Set the single checkout price (requires a ready payment connection).',
      )
      .argument('<id>', 'Plan id')
      .requiredOption('--currency <code>', 'ISO 4217 currency, e.g. usd')
      .requiredOption(
        '--amount-cents <n>',
        'Amount in smallest currency unit',
        parseIntArg('--amount-cents'),
      )
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ currency: string; amountCents: number }>();
        const r = unwrap(
          await getClient(this).setPrice(
            id,
            {
              currency: opts.currency,
              amountCents: opts.amountCents,
            },
            { idempotencyKey: newIdempotencyKey() },
          ),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PUT /v1/plans/:id/price',
      examples: [
        'cavuno plans set-price plans_xxx --currency usd --amount-cents 9900',
      ],
    },
  );

  annotate(
    plans
      .command('get-features')
      .description('List feature key/value pairs for a plan.')
      .argument('<id>', 'Plan id')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).getFeatures(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          getFormat(this),
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/plans/:id/features',
      examples: ['cavuno plans get-features plans_xxx'],
    },
  );

  annotate(
    plans
      .command('set-features')
      .description(
        'Replace plan feature values. Pass JSON: \'[{"key":"jobs.max_active","value":"10"}]\'.',
      )
      .argument('<id>', 'Plan id')
      .argument('<featuresJson>', 'JSON array of {key, value}')
      .action(async function (this: Command, id: string, featuresJson: string) {
        let features: SetPlanFeaturesBody['features'];
        try {
          features = JSON.parse(
            featuresJson,
          ) as SetPlanFeaturesBody['features'];
        } catch {
          console.error('featuresJson: expected a JSON array');
          process.exit(2);
        }
        const r = unwrap(
          await getClient(this).setFeatures(
            id,
            { features },
            { idempotencyKey: newIdempotencyKey() },
          ),
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
      mapsTo: 'PUT /v1/plans/:id/features',
      examples: [
        `cavuno plans set-features plans_xxx '[{"key":"jobs.max_active","value":"10"}]'`,
      ],
    },
  );
}
