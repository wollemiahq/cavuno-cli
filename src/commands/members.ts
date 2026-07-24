import { Command } from 'commander';

import { createMembersClient, type MemberRole } from '../api/members.js';

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
  return createMembersClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
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

function parseBool(flag: string) {
  return (raw: string): boolean => {
    if (raw !== 'true' && raw !== 'false') {
      console.error(`${flag}: expected true or false, got ${raw}`);
      process.exit(2);
    }
    return raw === 'true';
  };
}

export function registerMembersCommand(root: Command): void {
  const members = root
    .command('members')
    .description('Manage the members of the authenticated account.');

  annotate(
    members
      .command('list')
      .description('List account members.')
      .option('--role <role>', 'Filter by role (owner|admin|member)')
      .option(
        '--suspended <bool>',
        'Filter by suspension state (true|false)',
        parseBool('--suspended'),
      )
      .action(async function (this: Command) {
        const opts = this.opts<{ role?: MemberRole; suspended?: boolean }>();
        const r = unwrap(
          await getClient(this).list({
            ...(opts.role !== undefined && { role: opts.role }),
            ...(opts.suspended !== undefined && { suspended: opts.suspended }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), toRows);
      }),
    {
      mapsTo: 'GET /v1/members',
      examples: [
        'cavuno members list',
        'cavuno members list --role admin --suspended false',
      ],
    },
  );

  annotate(
    members
      .command('get')
      .description('Fetch a single member by user ID.')
      .argument('<userId>', 'The user ID of the member')
      .action(async function (this: Command, userId: string) {
        const r = unwrap(await getClient(this).get(userId));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/members/:userId',
      examples: ['cavuno members get users_k800abc'],
    },
  );

  annotate(
    withIdempotencyOption(
      members
        .command('update')
        .description(
          "Change a member's role. Only an owner may set `owner`; the primary owner's role is immutable (use transfer-ownership).",
        )
        .argument('<userId>', 'The user ID of the member')
        .requiredOption('--role <role>', 'The new role (owner|admin|member)'),
    ).action(async function (this: Command, userId: string) {
      const opts = this.opts<IdempotencyOptions & { role: MemberRole }>();
      const r = unwrap(
        await getClient(this).updateRole(
          userId,
          opts.role,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/members/:userId',
      examples: ['cavuno members update users_k800abc --role admin'],
    },
  );

  annotate(
    withYesOption(
      withIdempotencyOption(
        members
          .command('remove')
          .description(
            'Remove a member from the account. The account owner cannot be removed — transfer ownership first.',
          )
          .argument('<userId>', 'The user ID of the member'),
      ),
    ).action(async function (this: Command, userId: string) {
      const opts = this.opts<IdempotencyOptions & ConfirmOptions>();
      await confirmOrAbort({
        message: `Remove member ${userId} from the account?`,
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).remove(userId, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/members/:userId',
      examples: ['cavuno members remove users_k800abc --yes'],
    },
  );

  annotate(
    withIdempotencyOption(
      members
        .command('suspend')
        .description(
          'Suspend a member: they keep their role but lose all permission evaluations. The primary owner cannot be suspended.',
        )
        .argument('<userId>', 'The user ID of the member'),
    ).action(async function (this: Command, userId: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).suspend(userId, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/members/:userId/suspend',
      examples: ['cavuno members suspend users_k800abc'],
    },
  );

  annotate(
    withIdempotencyOption(
      members
        .command('unsuspend')
        .description('Reinstate a suspended member.')
        .argument('<userId>', 'The user ID of the member'),
    ).action(async function (this: Command, userId: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).unsuspend(userId, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/members/:userId/unsuspend',
      examples: ['cavuno members unsuspend users_k800abc'],
    },
  );

  annotate(
    withYesOption(
      withIdempotencyOption(
        members
          .command('transfer-ownership')
          .description(
            'Transfer the primary-owner role to another member. Only the current primary owner may do this — you will be demoted to admin and the transfer cannot be undone without the new owner transferring it back.',
          )
          .argument(
            '<newOwnerUserId>',
            'The user ID of the member who will become the primary owner',
          ),
      ),
    ).action(async function (this: Command, newOwnerUserId: string) {
      const opts = this.opts<IdempotencyOptions & ConfirmOptions>();
      await confirmOrAbort({
        message: `Transfer primary ownership to ${newOwnerUserId}? You will be demoted to admin and cannot undo this yourself.`,
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).transferOwnership(
          newOwnerUserId,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/members/transfer-ownership',
      examples: ['cavuno members transfer-ownership users_k900abc --yes'],
    },
  );
}
