import { Command } from 'commander';

import { createEmployersClient } from '../api/employers.js';
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

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createEmployersClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
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

export function registerEmployersCommand(root: Command): void {
  const employers = root
    .command('employers')
    .description('Manage employers, memberships, and company claims.');

  annotate(
    employers
      .command('list')
      .description('List employers (paginated).')
      .option('--search <query>', 'Substring search on email / display name')
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          search?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          await client.list({
            ...(opts.search !== undefined && { search: opts.search }),
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format, listExtractor);
      }),
    {
      mapsTo: 'GET /v1/employers',
      examples: [
        'cavuno employers list',
        'cavuno employers list --search acme',
      ],
    },
  );

  annotate(
    employers
      .command('get')
      .description('Fetch a single employer by ID (with memberships + claims).')
      .argument('<id>', 'Employer ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/employers/:id',
      examples: ['cavuno employers get nh7abc...'],
    },
  );

  annotate(
    withWaitOption(
      withYesOption(
        withIdempotencyOption(
          employers
            .command('delete')
            .description(
              'Permanently erase an employer and all associated data, including memberships/claims (GDPR cascade). Returns an employers.remove operation to poll.',
            )
            .argument('<id>', 'Employer ID'),
        ),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & ConfirmOptions & WaitOptions
      >();
      await confirmOrAbort({
        message: `Permanently erase employer ${id} and all associated data, including memberships/claims (GDPR cascade)?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(await client.remove(id, resolveIdempotency(opts)));
      if (r.error) throw fromApiError(r.error, r.response);
      await printOrWait(this, r, opts);
    }),
    {
      mapsTo: 'DELETE /v1/employers/:id',
      examples: [
        'cavuno employers delete nh7abc... --yes',
        'cavuno employers delete nh7abc... --yes --wait',
      ],
    },
  );

  annotate(
    employers
      .command('memberships')
      .description('List employer↔company memberships (paginated).')
      .option(
        '--status <status>',
        'Filter by status (pending|approved|rejected)',
      )
      .option('--company-id <id>', 'Filter to a single company')
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          status?: 'pending' | 'approved' | 'rejected';
          companyId?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          await client.listMemberships({
            ...(opts.status !== undefined && { status: opts.status }),
            ...(opts.companyId !== undefined && { companyId: opts.companyId }),
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format, listExtractor);
      }),
    {
      mapsTo: 'GET /v1/employers/memberships',
      examples: ['cavuno employers memberships --status approved'],
    },
  );

  annotate(
    employers
      .command('membership')
      .description('Fetch a single employer↔company membership by ID.')
      .argument('<id>', 'Membership ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.getMembership(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/employers/memberships/:id',
      examples: ['cavuno employers membership pd7abc...'],
    },
  );

  annotate(
    employers
      .command('claims')
      .description('List company claims (defaults to pending).')
      .option(
        '--status <status>',
        'Filter by status (pending|approved|rejected)',
      )
      .option('--company-id <id>', 'Filter to a single company')
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          status?: 'pending' | 'approved' | 'rejected';
          companyId?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          await client.listClaims({
            ...(opts.status !== undefined && { status: opts.status }),
            ...(opts.companyId !== undefined && { companyId: opts.companyId }),
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format, listExtractor);
      }),
    {
      mapsTo: 'GET /v1/employers/claims',
      examples: [
        'cavuno employers claims',
        'cavuno employers claims --status approved',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      employers
        .command('approve-claim')
        .description('Approve a pending company claim (idempotent).')
        .argument('<id>', 'Claim ID'),
    ).action(async function (this: Command, id: string) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(await client.approveClaim(id, resolveIdempotency(opts)));
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: 'POST /v1/employers/claims/:id/approve',
      examples: ['cavuno employers approve-claim pd7abc...'],
    },
  );

  annotate(
    withIdempotencyOption(
      employers
        .command('reject-claim')
        .description('Reject a pending company claim (idempotent).')
        .argument('<id>', 'Claim ID'),
    ).action(async function (this: Command, id: string) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(await client.rejectClaim(id, resolveIdempotency(opts)));
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: 'POST /v1/employers/claims/:id/reject',
      examples: ['cavuno employers reject-claim pd7abc...'],
    },
  );
}
