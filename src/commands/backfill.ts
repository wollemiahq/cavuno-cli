import { Command } from 'commander';

import { createBackfillClient } from '../api/backfill.js';
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

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createBackfillClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
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

function parseJsonArg(flag: string) {
  return (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      console.error(`${flag}: expected valid JSON`);
      process.exit(2);
    }
  };
}

function parseCsvIds(flag: string) {
  return (raw: string): string[] => {
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      console.error(`${flag}: expected at least one company id`);
      process.exit(2);
    }
    return ids;
  };
}

/**
 * Whole number, or an empty string to clear the setting. Returns `''` for
 * "clear" (Commander turns a parser's `null` back into `''` anyway);
 * `clearable` maps it to the API's `null`.
 */
function parseNullableInt(flag: string) {
  return (raw: string): number | '' => {
    if (raw.trim() === '') return '';
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      console.error(
        `${flag}: expected a whole number, or an empty string to clear`,
      );
      process.exit(2);
    }
    return value;
  };
}

export function registerBackfillCommand(root: Command): void {
  const backfill = root
    .command('backfill')
    .description(
      'Manage Backfill rules, company sources, Board-wide settings, and aggregate progress (dashboard-shaped Operator surface).',
    );

  // ── settings ─────────────────────────────────────────────────────────────
  const settings = backfill
    .command('settings')
    .description(
      'Board-wide Backfill controls: job limit, posted-within days, worldwide-remote exclusion, sponsored jobs.',
    );

  annotate(
    settings
      .command('get')
      .description('Show the Board-wide Backfill settings.')
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).getSettings());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/backfill/settings',
      examples: ['cavuno backfill settings get'],
    },
  );

  annotate(
    withIdempotencyOption(
      settings
        .command('update')
        .description(
          'Change one or more Board-wide Backfill settings. Omitted settings are unchanged.',
        )
        .option(
          '--job-limit <n>',
          'Most Backfill jobs live at once (1-100000); pass an empty string to clear',
          parseNullableInt('--job-limit'),
        )
        .option(
          '--max-job-age-days <n>',
          'Skip jobs posted more than N days ago (1-365); pass an empty string to clear',
          parseNullableInt('--max-job-age-days'),
        )
        .option(
          '--exclude-worldwide-remote',
          'Skip remote jobs open worldwide (expires those already live)',
        )
        .option(
          '--no-exclude-worldwide-remote',
          'Stop skipping remote jobs open worldwide',
        )
        .option('--sponsored-jobs', 'Include sponsored (pay-per-click) jobs')
        .option('--no-sponsored-jobs', 'Stop including sponsored jobs'),
    ).action(async function (this: Command) {
      const opts = this.opts<
        IdempotencyOptions & {
          jobLimit?: number | '';
          maxJobAgeDays?: number | '';
          excludeWorldwideRemote?: boolean;
          sponsoredJobs?: boolean;
        }
      >();
      const clearable = (value: number | '') => (value === '' ? null : value);
      const body: {
        jobLimit?: number | null;
        maxJobAgeDays?: number | null;
        excludeWorldwideRemote?: boolean;
        sponsoredJobsEnabled?: boolean;
      } = {};
      if (opts.jobLimit !== undefined) body.jobLimit = clearable(opts.jobLimit);
      if (opts.maxJobAgeDays !== undefined) {
        body.maxJobAgeDays = clearable(opts.maxJobAgeDays);
      }
      if (opts.excludeWorldwideRemote !== undefined) {
        body.excludeWorldwideRemote = opts.excludeWorldwideRemote;
      }
      if (opts.sponsoredJobs !== undefined) {
        body.sponsoredJobsEnabled = opts.sponsoredJobs;
      }
      if (Object.keys(body).length === 0) {
        console.error(
          'Pass at least one of --job-limit, --max-job-age-days, --[no-]exclude-worldwide-remote, --[no-]sponsored-jobs',
        );
        process.exit(2);
      }
      const r = unwrap(
        await getClient(this).updateSettings(body, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/backfill/settings',
      examples: [
        'cavuno backfill settings update --job-limit 2000 --max-job-age-days 30',
        `cavuno backfill settings update --job-limit ''`,
        'cavuno backfill settings update --exclude-worldwide-remote --no-sponsored-jobs',
      ],
    },
  );

  // ── blocked jobs ─────────────────────────────────────────────────────────
  const blockedJobs = backfill
    .command('blocked-jobs')
    .description('Removed jobs Backfill skips on this Board.');

  annotate(
    withYesOption(
      withIdempotencyOption(
        blockedJobs
          .command('unblock-all')
          .description(
            'Let Backfill import removed jobs again. Unblocks the first 200 now and the rest in the background.',
          ),
      ),
    ).action(async function (this: Command) {
      const opts = this.opts<IdempotencyOptions & ConfirmOptions>();
      await confirmOrAbort({
        message: 'Unblock every removed job so Backfill can import them again?',
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).unblockAllBlockedJobs(resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/backfill/blocked-jobs/unblock-all',
      examples: ['cavuno backfill blocked-jobs unblock-all --yes'],
    },
  );

  // ── progress ─────────────────────────────────────────────────────────────
  annotate(
    backfill
      .command('progress')
      .description(
        'Show aggregate Backfill progress for the Board (onboarding-shaped).',
      )
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).getProgress());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/backfill/progress',
      examples: ['cavuno backfill progress'],
    },
  );

  // ── rules ────────────────────────────────────────────────────────────────
  const rules = backfill
    .command('rules')
    .description('Named Backfill rule CRUD.');

  annotate(
    rules
      .command('list')
      .description('List named Backfill rules for the Board.')
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).listRules());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listExtractor);
      }),
    {
      mapsTo: 'GET /v1/backfill/rules',
      examples: ['cavuno backfill rules list'],
    },
  );

  annotate(
    rules
      .command('get')
      .description('Retrieve a Backfill rule by Cavuno ID.')
      .argument('<id>', 'Backfill rule ID')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).getRule(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/backfill/rules/{id}',
      examples: ['cavuno backfill rules get <id>'],
    },
  );

  annotate(
    withIdempotencyOption(
      rules
        .command('create')
        .description(
          'Create a named Backfill rule. Pass --rules as a JSON array of rule cards.',
        )
        .requiredOption('--name <name>', 'Rule display name')
        .requiredOption(
          '--rules <json>',
          'JSON array of { match, conditions[] } rule cards',
          parseJsonArg('--rules'),
        )
        .option(
          '--filters <json>',
          'JSON object of filters (countries, subdivisions, seniorities, employmentTypes, workplaceTypes)',
          parseJsonArg('--filters'),
        ),
    ).action(async function (this: Command) {
      const opts = this.opts<
        IdempotencyOptions & {
          name: string;
          rules: unknown;
          filters?: unknown;
        }
      >();
      const r = unwrap(
        await getClient(this).createRule(
          {
            name: opts.name,
            rules: opts.rules as never,
            ...(opts.filters !== undefined && {
              filters: opts.filters as never,
            }),
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/backfill/rules',
      examples: [
        `cavuno backfill rules create --name Engineering --rules '[{"match":"any","conditions":[{"field":"title","operator":"contains_any","terms":["engineer"]}]}]'`,
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      rules
        .command('update')
        .description(
          'Partially update a Backfill rule (name, rules, and/or filters).',
        )
        .argument('<id>', 'Backfill rule ID')
        .option('--name <name>', 'New display name')
        .option(
          '--rules <json>',
          'JSON array of rule cards replacing the current rules',
          parseJsonArg('--rules'),
        )
        .option(
          '--filters <json>',
          'JSON object of filters replacing the current filters',
          parseJsonArg('--filters'),
        ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & {
          name?: string;
          rules?: unknown;
          filters?: unknown;
        }
      >();
      const body: Record<string, unknown> = {};
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.rules !== undefined) body.rules = opts.rules;
      if (opts.filters !== undefined) body.filters = opts.filters;
      const r = unwrap(
        await getClient(this).updateRule(
          id,
          body as never,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/backfill/rules/{id}',
      examples: ['cavuno backfill rules update <id> --name "Platform eng"'],
    },
  );

  annotate(
    withYesOption(
      withIdempotencyOption(
        rules
          .command('remove')
          .description('Delete a named Backfill rule.')
          .argument('<id>', 'Backfill rule ID'),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<IdempotencyOptions & ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete Backfill rule ${id}?`,
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).removeRule(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/backfill/rules/{id}',
      examples: ['cavuno backfill rules remove <id> --yes'],
    },
  );

  // ── companies ────────────────────────────────────────────────────────────
  const companies = backfill
    .command('companies')
    .description(
      'Backfill company sources — list by dashboard state, start/stop, match.',
    );

  annotate(
    companies
      .command('list')
      .description(
        'List companies for one Backfill tab state (backfilling | available | needs_match | not_backfilling).',
      )
      .requiredOption(
        '--state <state>',
        'Tab state: backfilling | available | needs_match | not_backfilling',
      )
      .option('--search <text>', 'Case-insensitive name filter')
      .option('--limit <n>', 'Page size (1-100)', (v) => Number(v))
      .option('--cursor <cursor>', 'Opaque pagination cursor')
      .action(async function (this: Command) {
        const opts = this.opts<{
          state: string;
          search?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          await getClient(this).listCompanies({
            state: opts.state as
              | 'backfilling'
              | 'available'
              | 'needs_match'
              | 'not_backfilling',
            ...(opts.search !== undefined && { search: opts.search }),
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listExtractor);
      }),
    {
      mapsTo: 'GET /v1/backfill/companies',
      examples: [
        'cavuno backfill companies list --state available',
        'cavuno backfill companies list --state needs_match --search Acme',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      companies
        .command('start')
        .description('Start Backfill for a Cavuno company.')
        .argument('<companyId>', 'Cavuno company ID'),
    ).action(async function (this: Command, companyId: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).startCompany(companyId, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/backfill/companies/{companyId}/start',
      examples: ['cavuno backfill companies start <companyId>'],
    },
  );

  annotate(
    withIdempotencyOption(
      companies
        .command('stop')
        .description('Stop Backfill for a Cavuno company.')
        .argument('<companyId>', 'Cavuno company ID'),
    ).action(async function (this: Command, companyId: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).stopCompany(companyId, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/backfill/companies/{companyId}/stop',
      examples: ['cavuno backfill companies stop <companyId>'],
    },
  );

  annotate(
    withIdempotencyOption(
      companies
        .command('bulk-start')
        .description(
          'Start Backfill for up to 100 Cavuno company IDs (ordered partial success).',
        )
        .requiredOption(
          '--company-ids <ids>',
          'Comma-separated Cavuno company IDs',
          parseCsvIds('--company-ids'),
        ),
    ).action(async function (this: Command) {
      const opts = this.opts<IdempotencyOptions & { companyIds: string[] }>();
      const r = unwrap(
        await getClient(this).bulkStartCompanies(
          { companyIds: opts.companyIds },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/backfill/companies/bulk-start',
      examples: ['cavuno backfill companies bulk-start --company-ids co1,co2'],
    },
  );

  annotate(
    withIdempotencyOption(
      companies
        .command('bulk-stop')
        .description(
          'Stop Backfill for up to 100 Cavuno company IDs (ordered partial success).',
        )
        .requiredOption(
          '--company-ids <ids>',
          'Comma-separated Cavuno company IDs',
          parseCsvIds('--company-ids'),
        ),
    ).action(async function (this: Command) {
      const opts = this.opts<IdempotencyOptions & { companyIds: string[] }>();
      const r = unwrap(
        await getClient(this).bulkStopCompanies(
          { companyIds: opts.companyIds },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/backfill/companies/bulk-stop',
      examples: ['cavuno backfill companies bulk-stop --company-ids co1,co2'],
    },
  );

  annotate(
    withIdempotencyOption(
      companies
        .command('match')
        .description(
          'Confirm a needs_match candidate by list index. Optionally start backfill.',
        )
        .argument('<companyId>', 'Cavuno company ID')
        .requiredOption(
          '--candidate-index <n>',
          'Zero-based candidate index from list',
          (v) => Number(v),
        )
        .option(
          '--start',
          'Start backfill after linking the match (default false)',
          false,
        ),
    ).action(async function (this: Command, companyId: string) {
      const opts = this.opts<
        IdempotencyOptions & { candidateIndex: number; start?: boolean }
      >();
      const r = unwrap(
        await getClient(this).matchCompany(
          companyId,
          {
            candidateIndex: opts.candidateIndex,
            start: Boolean(opts.start),
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/backfill/companies/{companyId}/match',
      examples: [
        'cavuno backfill companies match <companyId> --candidate-index 0 --start',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      companies
        .command('mark-no-match')
        .description('Mark a needs_match company as no match.')
        .argument('<companyId>', 'Cavuno company ID'),
    ).action(async function (this: Command, companyId: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).markNoMatch(companyId, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/backfill/companies/{companyId}/mark-no-match',
      examples: ['cavuno backfill companies mark-no-match <companyId>'],
    },
  );
}
