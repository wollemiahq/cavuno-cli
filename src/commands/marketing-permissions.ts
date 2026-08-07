import { Command } from 'commander';

import {
  createMarketingPermissionsClient,
  type MarketingPermissionsListQuery,
} from '../api/marketing-permissions.js';
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
  return createMarketingPermissionsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

function parseLimit(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    console.error('--limit: expected an integer from 1 to 100');
    process.exit(2);
  }
  return value;
}

/**
 * Marketing consent lives on the board user record. The CLI can read the
 * decisions and withdraw on an operator's behalf; granting is
 * person-authoritative and deliberately has no CLI command.
 */
export function registerMarketingPermissionsCommand(root: Command): void {
  const marketingPermissions = root
    .command('marketing-permissions')
    .description(
      'Read marketing-email consent decisions off the board user records, and withdraw on request. Grants exist only on Board-user surfaces.',
    );

  annotate(
    marketingPermissions
      .command('list')
      .description(
        'List recorded consent decisions. People who never decided are absent — absence means no consent, never a default.',
      )
      .option('--status <status>', 'granted or withdrawn')
      .option('--email <email>', 'Exact-match lookup; returns at most one item')
      .option('--limit <n>', 'Page size (1-100)', parseLimit)
      .option('--cursor <cursor>', 'Opaque pagination cursor')
      .action(async function (this: Command) {
        const opts = this.opts<{
          status?: string;
          email?: string;
          limit?: number;
          cursor?: string;
        }>();
        if (
          opts.status !== undefined &&
          opts.status !== 'granted' &&
          opts.status !== 'withdrawn'
        ) {
          console.error('--status: expected granted or withdrawn');
          process.exit(2);
        }
        const query: MarketingPermissionsListQuery = {
          ...(opts.status === undefined
            ? {}
            : { status: opts.status as 'granted' | 'withdrawn' }),
          ...(opts.email === undefined ? {} : { email: opts.email }),
          ...(opts.limit === undefined ? {} : { limit: opts.limit }),
          ...(opts.cursor === undefined ? {} : { cursor: opts.cursor }),
        };
        const { data, error, response } = await getClient(this).list(query);
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/marketing-permissions',
      examples: [
        'cavuno marketing-permissions list',
        'cavuno marketing-permissions list --status granted',
        'cavuno marketing-permissions list --email person@example.com',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        marketingPermissions
          .command('withdraw')
          .description(
            "Withdraw a board user's marketing consent (reason: operator_request) — the right move when someone asks you directly to be removed. Idempotent. Cannot grant or restore.",
          )
          .argument('<boardUserId>', 'The board user ID'),
      ),
    ).action(async function (this: Command, boardUserId: string) {
      const opts = this.opts<ConfirmOptions & IdempotencyOptions>();
      await confirmOrAbort({
        message: `Withdraw marketing consent for board user ${boardUserId}?`,
        yes: opts.yes,
      });
      const { data, error, response } = await getClient(this).withdraw(
        boardUserId,
        resolveIdempotency(opts),
      );
      if (error) throw fromApiError(error, response);
      print(data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/marketing-permissions/{id}/withdraw',
      examples: [
        'cavuno marketing-permissions withdraw boardUsers_01EXAMPLE --yes',
      ],
    },
  );
}
