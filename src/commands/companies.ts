import { Command } from 'commander';

import { createCompaniesClient } from '../api/companies.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { readBatchBody } from '../lib/batch-body.js';
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

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createCompaniesClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
}

function parseCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXTENSION)) {
    if (lower.endsWith(ext)) return mime;
  }
  return 'application/octet-stream';
}

async function createFileFormData(filePath: string): Promise<FormData> {
  const buffer = await readFile(filePath);
  const file = new Blob([buffer], { type: inferMimeFromPath(filePath) });
  Object.defineProperty(file, 'name', {
    value: basename(filePath),
    configurable: true,
  });
  const formData = new FormData();
  formData.set('file', file);
  return formData;
}

export function registerCompaniesCommand(root: Command): void {
  const companies = root
    .command('companies')
    .description('Manage companies in the authenticated account.');

  annotate(
    companies
      .command('list')
      .description('List companies (paginated).')
      .option('--search <query>', 'Substring search on name')
      .option(
        '--markets <slugs>',
        'Comma-separated canonical market slugs',
        parseCsv,
      )
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          search?: string;
          markets?: string[];
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          opts.search !== undefined || opts.markets !== undefined
            ? await client.search({
                query: opts.search,
                cursor: opts.cursor,
                limit: opts.limit,
                ...(opts.markets !== undefined && {
                  filters: { markets: opts.markets },
                }),
              })
            : await client.list({ limit: opts.limit, cursor: opts.cursor }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          format,
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/companies',
      examples: [
        'cavuno companies list',
        'cavuno companies list --search acme --limit 10',
      ],
    },
  );

  annotate(
    companies
      .command('get')
      .description('Fetch a single company by ID.')
      .argument('<id>', 'Company ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/companies/:id',
      examples: ['cavuno companies get k18acme...'],
    },
  );

  // Mirrors POST /v1/companies (Finding 27). Slug + description + the
  // three social URLs are all optional on the wire; bare X handles
  // (`@cavuno`) and bare LinkedIn/Facebook paths (no scheme) are
  // accepted — the API normalizes them server-side.
  annotate(
    companies
      .command('create')
      .description('Create a company.')
      .requiredOption('--name <name>', 'Company name (required)')
      .option('--slug <slug>', 'URL slug; auto-derived from --name if omitted')
      .option('--website <url>', 'Website URL')
      .option('--summary <text>', 'Short summary (≤280 chars)')
      .option('--description <text>', 'Long-form description (≤25,000 chars)')
      .option('--x-url <handle-or-url>', 'X (Twitter) handle or profile URL')
      .option(
        '--linkedin-url <url-or-path>',
        'LinkedIn company page URL or path',
      )
      .option(
        '--facebook-url <url-or-path>',
        'Facebook company page URL or path',
      )
      .option(
        '--markets <slugs>',
        'Comma-separated canonical market slugs',
        parseCsv,
      )
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          name: string;
          slug?: string;
          website?: string;
          summary?: string;
          description?: string;
          xUrl?: string;
          linkedinUrl?: string;
          facebookUrl?: string;
          markets?: string[];
        }>();
        const r = unwrap(
          await client.create({
            name: opts.name,
            ...(opts.slug !== undefined && { slug: opts.slug }),
            ...(opts.website !== undefined && { website: opts.website }),
            ...(opts.summary !== undefined && { summary: opts.summary }),
            ...(opts.description !== undefined && {
              description: opts.description,
            }),
            ...(opts.xUrl !== undefined && { xUrl: opts.xUrl }),
            ...(opts.linkedinUrl !== undefined && {
              linkedinUrl: opts.linkedinUrl,
            }),
            ...(opts.facebookUrl !== undefined && {
              facebookUrl: opts.facebookUrl,
            }),
            ...(opts.markets !== undefined && { markets: opts.markets }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/companies',
      examples: [
        'cavuno companies create --name "Acme Corp"',
        'cavuno companies create \\\n  --name "Acme Corp" \\\n  --website https://acme.com \\\n  --summary "World-class widgets"',
      ],
    },
  );

  annotate(
    companies
      .command('update')
      .description('Update a company (partial).')
      .argument('<id>', 'Company ID')
      .option('--name <name>', 'New name')
      .option('--slug <slug>', 'New URL slug')
      .option('--website <url>', 'New website URL')
      .option('--summary <text>', 'New summary')
      .option('--description <text>', 'New long-form description')
      .option('--x-url <handle-or-url>', 'New X handle or profile URL')
      .option('--linkedin-url <url-or-path>', 'New LinkedIn URL or path')
      .option('--facebook-url <url-or-path>', 'New Facebook URL or path')
      .option(
        '--markets <slugs>',
        'Comma-separated canonical market slugs; pass an empty string to clear',
        parseCsv,
      )
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          name?: string;
          slug?: string;
          website?: string;
          summary?: string;
          description?: string;
          xUrl?: string;
          linkedinUrl?: string;
          facebookUrl?: string;
          markets?: string[];
        }>();
        const body: Record<string, unknown> = {};
        if (opts.name !== undefined) body.name = opts.name;
        if (opts.slug !== undefined) body.slug = opts.slug;
        if (opts.website !== undefined) body.website = opts.website;
        if (opts.summary !== undefined) body.summary = opts.summary;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.xUrl !== undefined) body.xUrl = opts.xUrl;
        if (opts.linkedinUrl !== undefined) body.linkedinUrl = opts.linkedinUrl;
        if (opts.facebookUrl !== undefined) body.facebookUrl = opts.facebookUrl;
        if (opts.markets !== undefined) body.markets = opts.markets;
        const r = unwrap(await client.update(id, body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'PATCH /v1/companies/:id',
      examples: [
        'cavuno companies update k18acme... --name "Acme, Inc."',
        'cavuno companies update k18acme... --website https://acme.io',
      ],
    },
  );

  annotate(
    withYesOption(
      companies
        .command('delete')
        .description('Delete a company and cascade-delete its jobs.')
        .argument('<id>', 'Company ID')
        .option(
          '--block',
          'Delete and block: keep the company blocked so backfill, imports and the API cannot add it back until it is unblocked.',
        ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions & { block?: boolean }>();
      await confirmOrAbort({
        message: opts.block
          ? `Delete company ${id}, cascade-delete its jobs, and block it from being added back?`
          : `Delete company ${id} and cascade-delete its jobs?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(
        await client.remove(id, opts.block ? { block: true } : undefined),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/companies/:id',
      examples: [
        'cavuno companies delete k18acme... --yes',
        'cavuno companies delete k18acme... --block --yes',
      ],
    },
  );

  annotate(
    companies
      .command('upload-logo')
      .description('Upload or replace a company logo.')
      .argument('<id>', 'Company ID')
      .argument('<file>', 'Path to a PNG, JPEG, WebP, or GIF logo file')
      .action(async function (this: Command, id: string, filePath: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const formData = await createFileFormData(filePath);
        const r = unwrap(await client.uploadLogo(id, formData));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/companies/:id/logo',
      examples: ['cavuno companies upload-logo k18acme... ./acme-logo.png'],
    },
  );

  annotate(
    withYesOption(
      companies
        .command('delete-logo')
        .description('Delete a company logo.')
        .argument('<id>', 'Company ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete the logo for company ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(await client.deleteLogo(id));
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/companies/:id/logo',
      examples: ['cavuno companies delete-logo k18acme... --yes'],
    },
  );

  annotate(
    companies
      .command('find-by-domain')
      .description(
        'Resolve a company by website domain (uses search endpoint).',
      )
      .argument('<domain>', 'Website domain (e.g. acme.com)')
      .action(async function (this: Command, domain: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(
          await client.search({
            query: domain,
            limit: 5,
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/companies/search',
      examples: ['cavuno companies find-by-domain acme.com'],
    },
  );

  annotate(
    companies
      .command('find-or-create')
      .description('Resolve to an existing company by domain or create one.')
      .requiredOption('--name <name>', 'Company name')
      .option('--website <url>', 'Website URL (used for dedup)')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ name: string; website?: string }>();
        const r = unwrap(
          await client.findOrCreate({
            name: opts.name,
            ...(opts.website !== undefined && { website: opts.website }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/companies/find-or-create',
      examples: [
        'cavuno companies find-or-create --name "Acme Corp" --website acme.com',
      ],
    },
  );

  annotate(
    companies
      .command('search')
      .description('Search companies by name and market.')
      .argument('[query]', 'Free-text query')
      .option(
        '--markets <slugs>',
        'Comma-separated canonical market slugs',
        parseCsv,
      )
      .option('--limit <n>', 'Page size 1-100 (default 25)', (v) =>
        parseInt(v, 10),
      )
      .action(async function (this: Command, query?: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ markets?: string[]; limit?: number }>();
        const r = unwrap(
          await client.search({
            query,
            limit: opts.limit,
            ...(opts.markets !== undefined && {
              filters: { markets: opts.markets },
            }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/companies/search',
      examples: ['cavuno companies search "acme" --limit 10'],
    },
  );

  annotate(
    withYesOption(
      companies
        .command('block')
        .description(
          'Block a company: stop automated re-import (backfill, import, API bulk). By default live jobs are archived and the profile stays; pass --remove to also remove the profile and its jobs from the board.',
        )
        .argument('<id>', 'Company ID')
        .option('--reason <text>', 'Optional free-text reason')
        .option(
          '--remove',
          'Also remove the company profile and its jobs from the board. The company stays blocked so nothing can add it back.',
        )
        .action(async function (this: Command, id: string) {
          const opts = this.opts<{ reason?: string; remove?: boolean }>();
          await confirmOrAbort({
            message: opts.remove
              ? `Block company ${id} and remove it from the board? Its jobs and profile will be removed; automated sourcing will reject this employer until unblocked.`
              : `Block company ${id}? Live jobs will be archived; automated sourcing will reject this employer until unblocked.`,
            yes: this.optsWithGlobals<ConfirmOptions>().yes,
          });
          const client = getClient(this);
          const format = getFormat(this);
          const r = unwrap(
            await client.block(id, {
              ...(opts.reason !== undefined && { reason: opts.reason }),
              ...(opts.remove ? { remove: true } : {}),
            }),
          );
          if (r.error) throw fromApiError(r.error, r.response);
          print(r.data, format);
        }),
    ),
    {
      mapsTo: 'POST /v1/companies/:id/block',
      examples: [
        'cavuno companies block k18acme... --yes',
        'cavuno companies block k18acme... --reason "legal request" --yes',
        'cavuno companies block k18acme... --remove --yes',
      ],
    },
  );

  annotate(
    withYesOption(
      companies
        .command('unblock')
        .description(
          'Unblock a company so automated sourcing can add jobs again. Does not republish archived jobs.',
        )
        .argument('<id>', 'Company ID')
        .action(async function (this: Command, id: string) {
          await confirmOrAbort({
            message: `Unblock company ${id}? Archived jobs will not be republished automatically.`,
            yes: this.optsWithGlobals<ConfirmOptions>().yes,
          });
          const client = getClient(this);
          const format = getFormat(this);
          const r = unwrap(await client.unblock(id));
          if (r.error) throw fromApiError(r.error, r.response);
          print(r.data, format);
        }),
    ),
    {
      mapsTo: 'POST /v1/companies/:id/unblock',
      examples: ['cavuno companies unblock k18acme... --yes'],
    },
  );

  annotate(
    companies
      .command('list-jobs')
      .description('List jobs at a company (any status, optional filter).')
      .argument('<id>', 'Company ID')
      .option(
        '--status <status>',
        'Filter by status (draft|pending_approval|published|expired|archived)',
      )
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ status?: string; limit?: number }>();
        const r = unwrap(await client.listJobs(id, opts));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/companies/:id/jobs',
      examples: ['cavuno companies list-jobs k18acme... --status published'],
    },
  );

  annotate(
    companies
      .command('list-plan-assignments')
      .description(
        'List the plans assigned to a company (active first, then expired and revoked).',
      )
      .argument('<id>', 'Company ID')
      .option('--status <status>', 'Filter by status (active|expired|revoked)')
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'Cursor from a previous page')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{
          status?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(await getClient(this).listPlanAssignments(id, opts));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/companies/:id/plan-assignments',
      examples: [
        'cavuno companies list-plan-assignments k18acme... --status active',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      companies
        .command('assign-plan')
        .description(
          'Assign a membership plan to a company at no charge. One membership per company; revoke the current one first.',
        )
        .argument('<id>', 'Company ID')
        .requiredOption('--plan <planId>', 'Active membership plan ID')
        .option(
          '--expires-at <iso>',
          'ISO-8601 time the assignment ends (default: no end)',
        ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & { plan: string; expiresAt?: string }
      >();
      const r = unwrap(
        await getClient(this).assignPlan(
          id,
          {
            planId: opts.plan,
            ...(opts.expiresAt !== undefined && { expiresAt: opts.expiresAt }),
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/companies/:id/plan-assignments',
      examples: [
        'cavuno companies assign-plan k18acme... --plan k22gold...',
        'cavuno companies assign-plan k18acme... --plan k22gold... --expires-at 2027-01-01T00:00:00Z',
      ],
    },
  );

  annotate(
    withYesOption(
      withIdempotencyOption(
        companies
          .command('revoke-plan')
          .description(
            "Revoke a company's plan assignment now. Does not cancel a recurring plan invoice.",
          )
          .argument('<id>', 'Company ID')
          .argument('<assignmentId>', 'Plan assignment ID'),
      ),
    ).action(async function (this: Command, id: string, assignmentId: string) {
      await confirmOrAbort({
        message: `Revoke plan assignment ${assignmentId} from company ${id}? The company loses the plan's benefits now.`,
        yes: this.optsWithGlobals<ConfirmOptions>().yes,
      });
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).revokePlanAssignment(
          id,
          assignmentId,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/companies/:id/plan-assignments/:assignmentId/revoke',
      examples: ['cavuno companies revoke-plan k18acme... k33assign... --yes'],
    },
  );

  annotate(
    companies
      .command('list-plan-invoices')
      .description(
        'List plan invoices issued to a company, newest first. A paid invoice names the assignment it created.',
      )
      .argument('<id>', 'Company ID')
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'Cursor from a previous page')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ limit?: number; cursor?: string }>();
        const r = unwrap(await getClient(this).listPlanInvoices(id, opts));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/companies/:id/plan-invoices',
      examples: ['cavuno companies list-plan-invoices k18acme...'],
    },
  );

  annotate(
    withIdempotencyOption(
      companies
        .command('invoice-plan')
        .description(
          'Invoice a company for a membership plan through Stripe (due in 30 days). Prints the invoice link to share with the employer; the plan is assigned when it is paid.',
        )
        .argument('<id>', 'Company ID')
        .requiredOption('--plan <planId>', 'Active membership plan ID')
        .requiredOption('--email <email>', "Employer's billing email")
        .option(
          '--amount-cents <n>',
          'Amount per invoice in minor units (only for a plan without a price)',
          (v) => parseInt(v, 10),
        )
        .option(
          '--currency <code>',
          'ISO 4217 currency, with --amount-cents (e.g. usd)',
        )
        .option(
          '--interval <interval>',
          'Make it recur: month|year (not for a subscription plan with its own interval)',
        )
        .option(
          '--interval-count <n>',
          'Intervals between invoices, 1-12 (month + 3 = quarterly)',
          (v) => parseInt(v, 10),
        ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & {
          plan: string;
          email: string;
          amountCents?: number;
          currency?: string;
          interval?: string;
          intervalCount?: number;
        }
      >();
      if (
        opts.interval !== undefined &&
        opts.interval !== 'month' &&
        opts.interval !== 'year'
      ) {
        console.error('--interval: expected month or year');
        process.exit(2);
      }
      const r = unwrap(
        await getClient(this).invoicePlan(
          id,
          {
            planId: opts.plan,
            contactEmail: opts.email,
            ...(opts.amountCents !== undefined && {
              amountCents: opts.amountCents,
            }),
            ...(opts.currency !== undefined && { currency: opts.currency }),
            ...(opts.interval !== undefined && {
              billingInterval: opts.interval,
            }),
            ...(opts.intervalCount !== undefined && {
              billingIntervalCount: opts.intervalCount,
            }),
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/companies/:id/plan-invoices',
      examples: [
        'cavuno companies invoice-plan k18acme... --plan k22gold... --email billing@acme.com',
        'cavuno companies invoice-plan k18acme... --plan k22silver... --email billing@acme.com --amount-cents 49900 --currency usd --interval month --interval-count 3',
      ],
    },
  );

  annotate(
    withYesOption(
      withIdempotencyOption(
        companies
          .command('cancel-plan-invoice')
          .description(
            'Cancel a plan invoice awaiting payment: a recurring invoice stops, and the Stripe invoice is voided.',
          )
          .argument('<id>', 'Company ID')
          .argument('<invoiceId>', 'Plan invoice ID'),
      ),
    ).action(async function (this: Command, id: string, invoiceId: string) {
      await confirmOrAbort({
        message: `Cancel plan invoice ${invoiceId} for company ${id}? The employer can no longer pay it.`,
        yes: this.optsWithGlobals<ConfirmOptions>().yes,
      });
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).cancelPlanInvoice(
          id,
          invoiceId,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/companies/:id/plan-invoices/:invoiceId/cancel',
      examples: [
        'cavuno companies cancel-plan-invoice k18acme... k44invoice... --yes',
      ],
    },
  );

  annotate(
    companies
      .command('batch')
      .description(
        'Run a batch of company operations. Pass JSON via --file or stdin. Exit 0 on HTTP 200 even if some rows fail — inspect the body.',
      )
      .option('--file <path>', 'JSON file body (otherwise read stdin)')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ file?: string }>();
        const body = await readBatchBody(opts.file);
        const r = unwrap(await client.batch(body));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/companies/batch',
      examples: ['cavuno companies batch --file ops.json'],
    },
  );
}
