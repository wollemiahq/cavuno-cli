import { Command } from 'commander';

import { createCouponsClient } from '../api/coupons.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
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
  return createCouponsClient({
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

export function registerCouponsCommand(root: Command): void {
  const cmd = root
    .command('coupons')
    .description(
      'Manage Board coupons and promotion codes (billing.read / billing.manage).',
    );

  annotate(
    cmd
      .command('list')
      .description('List Board coupons.')
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
      mapsTo: 'GET /v1/coupons',
      examples: ['cavuno coupons list'],
    },
  );

  annotate(
    cmd
      .command('get')
      .description('Get a coupon by id.')
      .argument('<id>', 'Coupon id')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/coupons/:id',
      examples: ['cavuno coupons get coupon_xxx'],
    },
  );

  annotate(
    cmd
      .command('create')
      .description('Create a Board coupon.')
      .requiredOption('--name <name>', 'Coupon name')
      .option('--percent-off <n>', 'Percent off (0-100)', (raw) => Number(raw))
      .option(
        '--amount-off <n>',
        'Fixed discount in the currency major unit (e.g. 10 for $10, 1000 for ¥1000)',
        (raw) => Number(raw),
      )
      .option('--currency <code>', 'Currency for fixed amount (e.g. usd)')
      .requiredOption('--duration <duration>', 'once | forever | repeating')
      .option(
        '--duration-in-months <n>',
        'Required when duration=repeating',
        (raw) => Number(raw),
      )
      .option('--max-redemptions <n>', 'Max redemptions', (raw) => Number(raw))
      .action(async function (this: Command) {
        const opts = this.opts<{
          name: string;
          percentOff?: number;
          amountOff?: number;
          currency?: string;
          duration: 'once' | 'forever' | 'repeating';
          durationInMonths?: number;
          maxRedemptions?: number;
        }>();
        if (
          opts.duration !== 'once' &&
          opts.duration !== 'forever' &&
          opts.duration !== 'repeating'
        ) {
          console.error('--duration must be once, forever, or repeating');
          process.exit(2);
        }
        const r = unwrap(
          await getClient(this).create(
            {
              name: opts.name,
              duration: opts.duration,
              ...(opts.percentOff !== undefined
                ? { percentOff: opts.percentOff }
                : {}),
              ...(opts.amountOff !== undefined
                ? { amountOff: opts.amountOff }
                : {}),
              ...(opts.currency !== undefined
                ? { currency: opts.currency }
                : {}),
              ...(opts.durationInMonths !== undefined
                ? { durationInMonths: opts.durationInMonths }
                : {}),
              ...(opts.maxRedemptions !== undefined
                ? { maxRedemptions: opts.maxRedemptions }
                : {}),
            },
            { idempotencyKey: newIdempotencyKey() },
          ),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/coupons',
      examples: [
        'cavuno coupons create --name "Spring sale" --percent-off 20 --duration once',
      ],
    },
  );

  annotate(
    cmd
      .command('rename')
      .description('Rename a coupon.')
      .argument('<id>', 'Coupon id')
      .requiredOption('--name <name>', 'New name')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ name: string }>();
        const r = unwrap(
          await getClient(this).rename(
            id,
            { name: opts.name },
            { idempotencyKey: newIdempotencyKey() },
          ),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PATCH /v1/coupons/:id',
      examples: ['cavuno coupons rename coupon_xxx --name "Fall sale"'],
    },
  );

  annotate(
    withYesOption(
      cmd
        .command('delete')
        .description('Delete a coupon (destructive).')
        .argument('<id>', 'Coupon id'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete coupon ${id}? This cannot be undone.`,
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).remove(id, {
          idempotencyKey: newIdempotencyKey(),
        }),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data ?? { deleted: true, id }, getFormat(this));
    }),
    {
      mapsTo: 'DELETE /v1/coupons/:id',
      examples: ['cavuno coupons delete coupon_xxx --yes'],
    },
  );

  annotate(
    cmd
      .command('promotion-code-create')
      .description('Create a promotion code for a coupon.')
      .argument('<couponId>', 'Coupon id')
      .requiredOption('--code <code>', 'Promotion code string')
      .option('--max-redemptions <n>', 'Max redemptions', (raw) => Number(raw))
      .option('--expires-at <iso>', 'ISO-8601 expiry')
      .action(async function (this: Command, couponId: string) {
        const opts = this.opts<{
          code: string;
          maxRedemptions?: number;
          expiresAt?: string;
        }>();
        const r = unwrap(
          await getClient(this).createPromotionCode(
            couponId,
            {
              code: opts.code,
              ...(opts.maxRedemptions !== undefined
                ? { maxRedemptions: opts.maxRedemptions }
                : {}),
              ...(opts.expiresAt !== undefined
                ? { expiresAt: opts.expiresAt }
                : {}),
            },
            { idempotencyKey: newIdempotencyKey() },
          ),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/coupons/:id/promotion-codes',
      examples: [
        'cavuno coupons promotion-code-create coupon_xxx --code SPRING20',
      ],
    },
  );

  annotate(
    cmd
      .command('promotion-code-archive')
      .description('Archive (deactivate) a promotion code.')
      .argument('<id>', 'Promotion code id')
      .action(async function (this: Command, id: string) {
        const r = unwrap(
          await getClient(this).archivePromotionCode(id, {
            idempotencyKey: newIdempotencyKey(),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/coupons/promotion-codes/:id/archive',
      examples: ['cavuno coupons promotion-code-archive promotion_xxx'],
    },
  );
}
