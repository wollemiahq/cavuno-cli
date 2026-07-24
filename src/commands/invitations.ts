import { Command } from 'commander';

import {
  createInvitationsClient,
  type InvitationRole,
} from '../api/invitations.js';

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
  return createInvitationsClient({
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

const toRows = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

function parseIntArg(flag: string) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      console.error(`${flag}: expected an integer from 1 to 100, got ${raw}`);
      process.exit(2);
    }
    return n;
  };
}

export function registerInvitationsCommand(root: Command): void {
  const invitations = root
    .command('invitations')
    .description('Manage pending invitations for the authenticated account.');

  annotate(
    invitations
      .command('list')
      .description('List invitations (paginated). Accept tokens are redacted.')
      .option(
        '--status <status>',
        'Filter by status (pending|expired|accepted|declined)',
      )
      .option(
        '--limit <n>',
        'Page size 1-100 (default 50)',
        parseIntArg('--limit'),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const opts = this.opts<{
          status?: 'pending' | 'expired' | 'accepted' | 'declined';
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          await getClient(this).list({
            ...(opts.status !== undefined && { status: opts.status }),
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), toRows);
      }),
    {
      mapsTo: 'GET /v1/invitations',
      examples: [
        'cavuno invitations list',
        'cavuno invitations list --status pending',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      invitations
        .command('create')
        .description(
          'Invite a new member by email. The response includes the accept token and URL (returned only here and on renew).',
        )
        .requiredOption('--email <email>', 'The email address to invite')
        .requiredOption('--role <role>', 'The role on accept (admin|member)'),
    ).action(async function (this: Command) {
      const opts = this.opts<
        IdempotencyOptions & { email: string; role: InvitationRole }
      >();
      const r = unwrap(
        await getClient(this).create(
          { email: opts.email, role: opts.role },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/invitations',
      examples: [
        'cavuno invitations create --email new@acme.com --role member',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      invitations
        .command('update')
        .description("Change a pending invitation's role.")
        .argument('<id>', 'The invitation ID')
        .requiredOption('--role <role>', 'The new role (admin|member)'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<IdempotencyOptions & { role: InvitationRole }>();
      const r = unwrap(
        await getClient(this).updateRole(
          id,
          opts.role,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/invitations/:id',
      examples: ['cavuno invitations update invitations_k900abc --role admin'],
    },
  );

  annotate(
    withIdempotencyOption(
      invitations
        .command('renew')
        .description(
          'Rotate the accept token and extend the expiry by 7 days. This INVALIDATES the previous accept link and resends the email; the response includes the new token and URL.',
        )
        .argument('<id>', 'The invitation ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).renew(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/invitations/:id/renew',
      examples: ['cavuno invitations renew invitations_k900abc'],
    },
  );

  annotate(
    withYesOption(
      withIdempotencyOption(
        invitations
          .command('revoke')
          .description('Cancel a pending invitation.')
          .argument('<id>', 'The invitation ID'),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<IdempotencyOptions & ConfirmOptions>();
      await confirmOrAbort({
        message: `Revoke invitation ${id}?`,
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).revoke(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/invitations/:id',
      examples: ['cavuno invitations revoke invitations_k900abc --yes'],
    },
  );
}
