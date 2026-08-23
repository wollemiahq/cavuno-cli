import { Command } from 'commander';

import { createJobsClient } from '../api/jobs.js';
import { createUsageClient } from '../api/usage.js';
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
  return createJobsClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getUsageClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createUsageClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
}

// ─── Commander option parsers ───────────────────────────────────────────
// Parsers fail loudly with a clear flag-prefixed message so a typo'd
// `--salary-min not-a-number` exits with status 2 instead of forwarding
// `NaN` to the API. Stay inline (no shared util module) so CLI commands
// remain self-contained.

function parseFloatArg(flag: string) {
  return (raw: string): number => {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) {
      console.error(`${flag}: expected a number, got ${raw}`);
      process.exit(2);
    }
    return n;
  };
}

function parseIntArg(flag: string) {
  return (raw: string): number => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      console.error(`${flag}: expected an integer, got ${raw}`);
      process.exit(2);
    }
    return n;
  };
}

function parseBool(flag: string, raw: string): boolean {
  const normalized = raw.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes')
    return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no')
    return false;
  console.error(`${flag}: expected true|false, got ${raw}`);
  process.exit(2);
}

function parseCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseJsonArray(flag: string) {
  return (raw: string): unknown[] => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        console.error(`${flag}: expected a JSON array`);
        process.exit(2);
      }
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${flag}: invalid JSON — ${message}`);
      process.exit(2);
    }
  };
}

export function registerJobsCommand(root: Command): void {
  const jobs = root
    .command('jobs')
    .description('Manage jobs in the authenticated account.');

  // ── list ──────────────────────────────────────────────────────────────
  annotate(
    jobs
      .command('list')
      .description('List jobs (paginated).')
      .option(
        '--status <status>',
        'Filter by status (draft|published|expired|archived)',
      )
      .option('--company-id <id>', 'Filter by company ID')
      .option(
        '--search <query>',
        'Free-text search; routes through POST /v1/jobs/search',
      )
      .option(
        '--skills <slugs>',
        'Comma-separated canonical skill slugs',
        parseCsv,
      )
      .option(
        '--categories <slugs>',
        'Comma-separated canonical category slugs',
        parseCsv,
      )
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'Pagination cursor from previous response')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          status?: string;
          companyId?: string;
          search?: string;
          skills?: string[];
          categories?: string[];
          limit?: number;
          cursor?: string;
        }>();
        // `--search` re-routes through the search endpoint, since GET /v1/jobs
        // is strict about its query keys and does not accept free-text. The
        // search body takes status/companyId as arrays — wrap the singular
        // CLI flags into single-element arrays. The server validates status
        // against the canonical enum, so we forward as-is and let it 400.
        type StatusEnum = 'draft' | 'published' | 'expired' | 'archived';
        const usesSearchEndpoint =
          opts.search !== undefined ||
          opts.skills !== undefined ||
          opts.categories !== undefined;
        const result = usesSearchEndpoint
          ? await client.search({
              ...(opts.search !== undefined && { query: opts.search }),
              ...((opts.status ||
                opts.companyId ||
                opts.skills !== undefined ||
                opts.categories !== undefined) && {
                filters: {
                  ...(opts.status && { status: [opts.status as StatusEnum] }),
                  ...(opts.companyId && { companyId: [opts.companyId] }),
                  ...(opts.skills !== undefined && { skills: opts.skills }),
                  ...(opts.categories !== undefined && {
                    categories: opts.categories,
                  }),
                },
              }),
              ...(opts.limit !== undefined && { limit: opts.limit }),
              ...(opts.cursor !== undefined && { cursor: opts.cursor }),
            })
          : await client.list({
              ...(opts.status && { status: opts.status as StatusEnum }),
              ...(opts.companyId && { companyId: opts.companyId }),
              ...(opts.limit !== undefined && { limit: opts.limit }),
              ...(opts.cursor !== undefined && { cursor: opts.cursor }),
            });
        const { data, error, response } = result;
        if (error) throw fromApiError(error, response);
        print(
          data,
          format,
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo:
        'GET /v1/jobs (POST /v1/jobs/search when --search, --skills, or --categories is set)',
      examples: [
        '# All jobs (first page)\ncavuno jobs list',
        '# Published only\ncavuno jobs list --status published --limit 100',
        '# Published jobs at a single company\ncavuno jobs list --status published --company-id k17abc...',
      ],
    },
  );

  // ── get ───────────────────────────────────────────────────────────────
  annotate(
    jobs
      .command('get')
      .description(
        'Fetch a single job by ID (enriched with description, company, places).',
      )
      .argument('<id>', 'Job ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const { data, error, response } = await client.get(id);
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'GET /v1/jobs/:id',
      examples: [
        'cavuno jobs get k17abc...',
        'cavuno jobs get k17abc... | jq -r .title',
      ],
    },
  );

  // ── create ────────────────────────────────────────────────────────────
  // Mirrors the full POST /v1/jobs body (Finding 15). Complex fields
  // accept inline JSON so power users can set every supported field
  // from the command line without dropping down to curl.
  annotate(
    jobs
      .command('create')
      .description('Create a draft job.')
      .requiredOption('--title <title>', 'Job title (required)')
      .option('--description <text>', 'Description (markdown/HTML)')
      .option('--slug <slug>', 'URL slug; auto-derived from title if omitted')
      .option('--company-id <id>', 'Company ID (must belong to your account)')
      .option('--application-url <url>', 'Application URL or `mailto:`/email')
      .option(
        '--employment-type <type>',
        'full_time|part_time|contract|internship|temporary|volunteer|other',
      )
      .option('--remote-option <opt>', 'on_site|hybrid|remote')
      .option(
        '--seniority <level>',
        'entry_level|associate|mid_level|senior|lead|principal|director|executive',
      )
      .option(
        '--remote-sponsorship <opt>',
        'yes|no|unknown — visa sponsorship for remote candidates',
      )
      .option(
        '--remote-permits <json>',
        'JSON array, e.g. \'[{"type":"country","value":"US"}]\' — work-permit scope',
        parseJsonArray('--remote-permits'),
      )
      .option(
        '--remote-timezones <json>',
        'JSON array, e.g. \'[{"type":"all","value":"all"}]\' — timezone constraint (auto-derived from --remote-permits when omitted)',
        parseJsonArray('--remote-timezones'),
      )
      .option(
        '--office-locations <json>',
        'JSON array, e.g. \'[{"city":"Berlin","country":"DE"}]\' — required for on_site/hybrid',
        parseJsonArray('--office-locations'),
      )
      .option(
        '--in-office-period <opt>',
        'per_week|per_month|per_year — denominator for --in-office-frequency (hybrid)',
      )
      .option(
        '--in-office-frequency <n>',
        'In-office count per period (hybrid)',
        parseFloatArg('--in-office-frequency'),
      )
      .option(
        '--salary-min <n>',
        'Minimum salary',
        parseFloatArg('--salary-min'),
      )
      .option(
        '--salary-max <n>',
        'Maximum salary',
        parseFloatArg('--salary-max'),
      )
      .option(
        '--salary-currency <code>',
        'ISO 4217 currency (e.g. USD, EUR, GBP)',
      )
      .option(
        '--salary-timeframe <opt>',
        'per_year|per_month|per_week|per_day|per_hour',
      )
      .option(
        '--education-requirements <list>',
        'Comma-separated values: high_school,associate_degree,bachelor_degree,professional_certificate,postgraduate_degree,no_requirements',
        parseCsv,
      )
      .option(
        '--skills <slugs>',
        'Comma-separated canonical skill slugs',
        parseCsv,
      )
      .option(
        '--categories <slugs>',
        'Comma-separated canonical category slugs',
        parseCsv,
      )
      .option(
        '--experience-months <n>',
        'Minimum experience required, in months',
        parseIntArg('--experience-months'),
      )
      .option(
        '--experience-in-place-of-education',
        'Allow equivalent experience to substitute for education',
      )
      .option('--is-featured', 'Mark as a featured job on the public board')
      .option(
        '--expires-at <iso>',
        'Expiry as ISO 8601 datetime (defaults to 30 days from creation when omitted)',
      )
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          title: string;
          description?: string;
          slug?: string;
          companyId?: string;
          applicationUrl?: string;
          employmentType?: string;
          remoteOption?: string;
          seniority?: string;
          remoteSponsorship?: string;
          remotePermits?: unknown[];
          remoteTimezones?: unknown[];
          officeLocations?: unknown[];
          inOfficePeriod?: string;
          inOfficeFrequency?: number;
          salaryMin?: number;
          salaryMax?: number;
          salaryCurrency?: string;
          salaryTimeframe?: string;
          educationRequirements?: string[];
          skills?: string[];
          categories?: string[];
          experienceMonths?: number;
          experienceInPlaceOfEducation?: boolean;
          isFeatured?: boolean;
          expiresAt?: string;
        }>();
        const body: Record<string, unknown> = { title: opts.title };
        // Forward every set field. Booleans flagged with `--is-featured` /
        // `--experience-in-place-of-education` are forwarded as-is when
        // present; the absence of the flag means "leave the server default
        // alone", so we only set them when explicitly true.
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.slug !== undefined) body.slug = opts.slug;
        if (opts.companyId !== undefined) body.companyId = opts.companyId;
        if (opts.applicationUrl !== undefined)
          body.applicationUrl = opts.applicationUrl;
        if (opts.employmentType !== undefined)
          body.employmentType = opts.employmentType;
        if (opts.remoteOption !== undefined)
          body.remoteOption = opts.remoteOption;
        if (opts.seniority !== undefined) body.seniority = opts.seniority;
        if (opts.remoteSponsorship !== undefined)
          body.remoteSponsorship = opts.remoteSponsorship;
        if (opts.remotePermits !== undefined)
          body.remotePermits = opts.remotePermits;
        if (opts.remoteTimezones !== undefined)
          body.remoteTimezones = opts.remoteTimezones;
        if (opts.officeLocations !== undefined)
          body.officeLocations = opts.officeLocations;
        if (opts.inOfficePeriod !== undefined)
          body.inOfficePeriod = opts.inOfficePeriod;
        if (opts.inOfficeFrequency !== undefined)
          body.inOfficeFrequency = opts.inOfficeFrequency;
        if (opts.salaryMin !== undefined) body.salaryMin = opts.salaryMin;
        if (opts.salaryMax !== undefined) body.salaryMax = opts.salaryMax;
        if (opts.salaryCurrency !== undefined)
          body.salaryCurrency = opts.salaryCurrency;
        if (opts.salaryTimeframe !== undefined)
          body.salaryTimeframe = opts.salaryTimeframe;
        if (opts.educationRequirements !== undefined)
          body.educationRequirements = opts.educationRequirements;
        if (opts.skills !== undefined) body.skills = opts.skills;
        if (opts.categories !== undefined) body.categories = opts.categories;
        if (opts.experienceMonths !== undefined)
          body.experienceMonths = opts.experienceMonths;
        if (opts.experienceInPlaceOfEducation === true)
          body.experienceInPlaceOfEducation = true;
        if (opts.isFeatured === true) body.isFeatured = true;
        if (opts.expiresAt !== undefined) {
          const parsed = Date.parse(opts.expiresAt);
          if (Number.isNaN(parsed)) {
            console.error(
              `--expires-at: invalid ISO 8601 datetime: ${opts.expiresAt}`,
            );
            process.exit(2);
          }
          body.expiresAt = parsed;
        }
        const { data, error, response } = await client.create(
          body as Parameters<typeof client.create>[0],
        );
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'POST /v1/jobs',
      examples: [
        '# Minimal\ncavuno jobs create --title "Senior Backend Engineer"',
        '# Common remote-only case\ncavuno jobs create \\\n  --title "Senior Platform Engineer" \\\n  --description "We’re hiring..." \\\n  --employment-type full_time \\\n  --remote-option remote \\\n  --seniority senior \\\n  --company-id k18acme...',
        '# Hybrid role (requires --office-locations)\ncavuno jobs create \\\n  --title "Staff Engineer" \\\n  --remote-option hybrid \\\n  --in-office-period per_week \\\n  --in-office-frequency 2 \\\n  --office-locations \'[{"city":"Berlin","country":"DE"}]\'',
        '# Capture the new ID\nNEW_ID=$(cavuno jobs create --title "Test" | jq -r .id)',
      ],
    },
  );

  // ── update ────────────────────────────────────────────────────────────
  // PATCH parity with `create` (Finding 19). Same flag set minus
  // --title (now optional), and `status` is intentionally absent: status
  // changes go through /publish, /pause, /expire (Finding 17). Pass an
  // empty array (e.g. --remote-permits '[]') to clear an array field.
  annotate(
    jobs
      .command('update')
      .description('Update fields on an existing job.')
      .argument('<id>', 'Job ID')
      .option('--title <title>', '1–200 chars')
      .option('--description <text>', 'Description (markdown/HTML)')
      .option('--slug <slug>')
      .option('--company-id <id>', 'Company ID (must belong to your account)')
      .option('--application-url <url>', 'Application URL or `mailto:`/email')
      .option('--employment-type <type>')
      .option('--remote-option <opt>', 'on_site|hybrid|remote')
      .option('--seniority <level>')
      .option('--remote-sponsorship <opt>', 'yes|no|unknown')
      .option(
        '--remote-permits <json>',
        'JSON array; pass `[]` to clear',
        parseJsonArray('--remote-permits'),
      )
      .option(
        '--remote-timezones <json>',
        'JSON array; pass `[]` to clear (PATCH never auto-re-derives)',
        parseJsonArray('--remote-timezones'),
      )
      .option(
        '--office-locations <json>',
        'JSON array; required when --remote-option is on_site/hybrid',
        parseJsonArray('--office-locations'),
      )
      .option('--in-office-period <opt>', 'per_week|per_month|per_year')
      .option(
        '--in-office-frequency <n>',
        'Hybrid in-office count per period',
        parseFloatArg('--in-office-frequency'),
      )
      .option(
        '--salary-min <n>',
        'Minimum salary',
        parseFloatArg('--salary-min'),
      )
      .option(
        '--salary-max <n>',
        'Maximum salary',
        parseFloatArg('--salary-max'),
      )
      .option(
        '--salary-currency <code>',
        'ISO 4217 currency (e.g. USD, EUR, GBP)',
      )
      .option(
        '--salary-timeframe <opt>',
        'per_year|per_month|per_week|per_day|per_hour',
      )
      .option(
        '--education-requirements <list>',
        'Comma-separated list',
        parseCsv,
      )
      .option(
        '--skills <slugs>',
        'Comma-separated canonical skill slugs; pass an empty value to clear',
        parseCsv,
      )
      .option(
        '--categories <slugs>',
        'Comma-separated canonical category slugs; pass an empty value to clear',
        parseCsv,
      )
      .option(
        '--experience-months <n>',
        'Minimum experience required, in months',
        parseIntArg('--experience-months'),
      )
      .option(
        '--experience-in-place-of-education <bool>',
        'true|false (string accepted; PATCH semantics — explicit value required)',
      )
      .option(
        '--is-featured <bool>',
        'true|false (string accepted; PATCH semantics — explicit value required)',
      )
      .option(
        '--expires-at <iso>',
        'ISO 8601 datetime (parsed to epoch ms); pass `null` to clear',
      )
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          title?: string;
          description?: string;
          slug?: string;
          companyId?: string;
          applicationUrl?: string;
          employmentType?: string;
          remoteOption?: string;
          seniority?: string;
          remoteSponsorship?: string;
          remotePermits?: unknown[];
          remoteTimezones?: unknown[];
          officeLocations?: unknown[];
          inOfficePeriod?: string;
          inOfficeFrequency?: number;
          salaryMin?: number;
          salaryMax?: number;
          salaryCurrency?: string;
          salaryTimeframe?: string;
          educationRequirements?: string[];
          skills?: string[];
          categories?: string[];
          experienceMonths?: number;
          experienceInPlaceOfEducation?: string;
          isFeatured?: string;
          expiresAt?: string;
        }>();
        const body: Record<string, unknown> = {};
        // Plain string scalars + arrays + parsed numbers
        if (opts.title !== undefined) body.title = opts.title;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.slug !== undefined) body.slug = opts.slug;
        if (opts.companyId !== undefined) body.companyId = opts.companyId;
        if (opts.applicationUrl !== undefined)
          body.applicationUrl = opts.applicationUrl;
        if (opts.employmentType !== undefined)
          body.employmentType = opts.employmentType;
        if (opts.remoteOption !== undefined)
          body.remoteOption = opts.remoteOption;
        if (opts.seniority !== undefined) body.seniority = opts.seniority;
        if (opts.remoteSponsorship !== undefined)
          body.remoteSponsorship = opts.remoteSponsorship;
        if (opts.remotePermits !== undefined)
          body.remotePermits = opts.remotePermits;
        if (opts.remoteTimezones !== undefined)
          body.remoteTimezones = opts.remoteTimezones;
        if (opts.officeLocations !== undefined)
          body.officeLocations = opts.officeLocations;
        if (opts.inOfficePeriod !== undefined)
          body.inOfficePeriod = opts.inOfficePeriod;
        if (opts.inOfficeFrequency !== undefined)
          body.inOfficeFrequency = opts.inOfficeFrequency;
        if (opts.salaryMin !== undefined) body.salaryMin = opts.salaryMin;
        if (opts.salaryMax !== undefined) body.salaryMax = opts.salaryMax;
        if (opts.salaryCurrency !== undefined)
          body.salaryCurrency = opts.salaryCurrency;
        if (opts.salaryTimeframe !== undefined)
          body.salaryTimeframe = opts.salaryTimeframe;
        if (opts.educationRequirements !== undefined)
          body.educationRequirements = opts.educationRequirements;
        if (opts.skills !== undefined) body.skills = opts.skills;
        if (opts.categories !== undefined) body.categories = opts.categories;
        if (opts.experienceMonths !== undefined)
          body.experienceMonths = opts.experienceMonths;
        // PATCH-specific: booleans take an explicit value because absence
        // means "leave unchanged" rather than "set false". Same shape for
        // expiresAt where the literal string `null` clears the stored
        // value (mirrors the body-level tri-state).
        if (opts.experienceInPlaceOfEducation !== undefined)
          body.experienceInPlaceOfEducation = parseBool(
            '--experience-in-place-of-education',
            opts.experienceInPlaceOfEducation,
          );
        if (opts.isFeatured !== undefined)
          body.isFeatured = parseBool('--is-featured', opts.isFeatured);
        if (opts.expiresAt !== undefined) {
          if (opts.expiresAt.toLowerCase() === 'null') {
            body.expiresAt = null;
          } else {
            const parsed = Date.parse(opts.expiresAt);
            if (Number.isNaN(parsed)) {
              console.error(
                `--expires-at: invalid ISO 8601 datetime (or "null"): ${opts.expiresAt}`,
              );
              process.exit(2);
            }
            body.expiresAt = parsed;
          }
        }
        if (Object.keys(body).length === 0) {
          console.error('No fields to update — pass at least one --flag.');
          process.exit(2);
        }
        const { data, error, response } = await client.update(
          id,
          body as Parameters<typeof client.update>[1],
        );
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'PATCH /v1/jobs/:id',
      examples: [
        '# Rename\ncavuno jobs update k17abc... --title "Renamed role"',
        '# Re-author the remote-permit set + sponsorship\ncavuno jobs update k17abc... \\\n  --remote-permits \'[{"type":"country","value":"US"}]\' \\\n  --remote-sponsorship yes',
        '# Clear an existing expiry\ncavuno jobs update k17abc... --expires-at null',
        '# Mark as featured\ncavuno jobs update k17abc... --is-featured true',
      ],
    },
  );

  // ── publish ───────────────────────────────────────────────────────────
  annotate(
    jobs
      .command('publish')
      .description('Publish a job (draft or expired → published).')
      .argument('<id>', 'Job ID')
      .option('--expires-at <iso>', 'Optional ISO 8601 expiry timestamp')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ expiresAt?: string }>();
        const { data, error, response } = await client.publish(id, opts);
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'POST /v1/jobs/:id/publish',
      examples: [
        'cavuno jobs publish k17abc...',
        'cavuno jobs publish k17abc... --expires-at 2026-12-31T23:59:59Z',
      ],
    },
  );

  // ── pause / expire / duplicate ────────────────────────────────────────
  annotate(
    jobs
      .command('pause')
      .description('Pause a published job (transition to draft).')
      .argument('<id>', 'Job ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const { data, error, response } = await client.pause(id);
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'POST /v1/jobs/:id/pause',
      examples: ['cavuno jobs pause k17abc...'],
    },
  );

  annotate(
    jobs
      .command('expire')
      .description('Expire a published job immediately (sets expiresAt = now).')
      .argument('<id>', 'Job ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const { data, error, response } = await client.expire(id);
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'POST /v1/jobs/:id/expire',
      examples: ['cavuno jobs expire k17abc...'],
    },
  );

  annotate(
    jobs
      .command('duplicate')
      .description('Duplicate a job (creates a new draft copy).')
      .argument('<id>', 'Job ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const { data, error, response } = await client.duplicate(id);
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'POST /v1/jobs/:id/duplicate',
      examples: [
        'cavuno jobs duplicate k17abc...',
        'NEW_ID=$(cavuno jobs duplicate k17abc... | jq -r .id)',
      ],
    },
  );

  annotate(
    withYesOption(
      jobs
        .command('delete')
        .description('Hard-delete a job. Irreversible.')
        .argument('<id>', 'Job ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Permanently delete job ${id}? This is irreversible.`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const { error, response } = await client.remove(id);
      if (error) throw fromApiError(error, response);
    }),
    {
      mapsTo: 'DELETE /v1/jobs/:id',
      examples: ['cavuno jobs delete k17abc... --yes'],
    },
  );

  annotate(
    jobs
      .command('batch')
      .description(
        'Run a batch of job operations. Pass JSON via --file or stdin. Exit 0 on HTTP 200 even if some rows fail — inspect the body.',
      )
      .option('--file <path>', 'JSON file body (otherwise read stdin)')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ file?: string }>();
        const body = await readBatchBody(opts.file);
        const r = await client.batch(body as never);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/jobs/batch',
      examples: [
        'cavuno jobs batch --file ops.json',
        'echo \'{"operations":[]}\' | cavuno jobs batch',
      ],
    },
  );
}

export function registerUsageCommand(root: Command): void {
  const usage = root
    .command('usage')
    .description(
      'Inspect actionable product capacity (jobs, subscribers, seats).',
    );

  annotate(
    usage
      .command('get')
      .description(
        'Show used, limit, and remaining capacity for active jobs, confirmed subscribers, and team seats.',
      )
      .action(async function (this: Command) {
        const client = getUsageClient(this);
        const format = getFormat(this);
        const { data, error, response } = await client.get();
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'GET /v1/usage',
      examples: ['cavuno usage get'],
    },
  );
}
