import { Command } from 'commander';

import { createSalesLedPlansClient } from '../api/sales-led-plans.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { fromApiError } from '../lib/error.js';
import {
  resolveIdempotency,
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
  return createSalesLedPlansClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    console.error('--body must be valid JSON');
    process.exit(2);
  }
}

/**
 * Contact-led employer pricing cards (sales-led plans).
 */
export function registerSalesLedPlansCommand(root: Command): void {
  const salesLed = root
    .command('sales-led-plans')
    .description(
      'Manage contact-led employer pricing cards (CRUD, reorder, publish, hide, archive).',
    );

  annotate(
    salesLed
      .command('list')
      .description('List active sales-led plans for the Board.')
      .action(async function (this: Command) {
        const { data, error, response } = await getClient(this).list();
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/sales-led-plans',
      examples: ['cavuno sales-led-plans list'],
    },
  );

  annotate(
    salesLed
      .command('get')
      .description('Retrieve one sales-led plan by ID.')
      .argument('<id>', 'Sales-led plan ID')
      .action(async function (this: Command, id: string) {
        const { data, error, response } = await getClient(this).get(id);
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/sales-led-plans/{id}',
      examples: ['cavuno sales-led-plans get <id>'],
    },
  );

  annotate(
    withIdempotencyOption(
      salesLed
        .command('create')
        .description(
          'Create a sales-led plan. Requires --idempotency-key (or CAVUNO_IDEMPOTENCY_KEY).',
        )
        .requiredOption('--body <json>', 'CreateSalesLedPlanBody JSON')
        .action(async function (this: Command) {
          const opts = this.opts<{ body: string; idempotencyKey?: string }>();
          const { data, error, response } = await getClient(this).create(
            parseBody(opts.body) as never,
            resolveIdempotency(opts),
          );
          if (error) throw fromApiError(error, response);
          print(data, getFormat(this));
        }),
    ),
    {
      mapsTo: 'POST /v1/sales-led-plans',
      examples: [
        'cavuno sales-led-plans create --body \'{"name":"Full search",...}\' --idempotency-key $(uuidgen)',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      salesLed
        .command('update')
        .description(
          'Update a sales-led plan (full field replace). Requires --idempotency-key.',
        )
        .argument('<id>', 'Sales-led plan ID')
        .requiredOption('--body <json>', 'UpdateSalesLedPlanBody JSON')
        .action(async function (this: Command, id: string) {
          const opts = this.opts<{ body: string; idempotencyKey?: string }>();
          const { data, error, response } = await getClient(this).update(
            id,
            parseBody(opts.body) as never,
            resolveIdempotency(opts),
          );
          if (error) throw fromApiError(error, response);
          print(data, getFormat(this));
        }),
    ),
    {
      mapsTo: 'PATCH /v1/sales-led-plans/{id}',
      examples: [
        'cavuno sales-led-plans update <id> --body \'{"name":"…",...}\' --idempotency-key $(uuidgen)',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      salesLed
        .command('reorder')
        .description(
          'Atomically reorder the complete active set. Requires --idempotency-key.',
        )
        .requiredOption(
          '--body <json>',
          'ReorderSalesLedPlansBody JSON ({"orders":[{"id":"…","displayOrder":0},…]})',
        )
        .action(async function (this: Command) {
          const opts = this.opts<{ body: string; idempotencyKey?: string }>();
          const { data, error, response } = await getClient(this).reorder(
            parseBody(opts.body) as never,
            resolveIdempotency(opts),
          );
          if (error) throw fromApiError(error, response);
          print(data, getFormat(this));
        }),
    ),
    {
      mapsTo: 'POST /v1/sales-led-plans/reorder',
      examples: [
        'cavuno sales-led-plans reorder --body \'{"orders":[...]}\' --idempotency-key $(uuidgen)',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      salesLed
        .command('publish')
        .description('Publish a sales-led plan. Requires --idempotency-key.')
        .argument('<id>', 'Sales-led plan ID')
        .action(async function (this: Command, id: string) {
          const opts = this.opts<{ idempotencyKey?: string }>();
          const { data, error, response } = await getClient(this).publish(
            id,
            resolveIdempotency(opts),
          );
          if (error) throw fromApiError(error, response);
          print(data, getFormat(this));
        }),
    ),
    {
      mapsTo: 'POST /v1/sales-led-plans/{id}/publish',
      examples: [
        'cavuno sales-led-plans publish <id> --idempotency-key $(uuidgen)',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      salesLed
        .command('hide')
        .description('Hide a sales-led plan. Requires --idempotency-key.')
        .argument('<id>', 'Sales-led plan ID')
        .action(async function (this: Command, id: string) {
          const opts = this.opts<{ idempotencyKey?: string }>();
          const { data, error, response } = await getClient(this).hide(
            id,
            resolveIdempotency(opts),
          );
          if (error) throw fromApiError(error, response);
          print(data, getFormat(this));
        }),
    ),
    {
      mapsTo: 'POST /v1/sales-led-plans/{id}/hide',
      examples: [
        'cavuno sales-led-plans hide <id> --idempotency-key $(uuidgen)',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      salesLed
        .command('archive')
        .description(
          'Irreversibly archive a sales-led plan. Requires --idempotency-key.',
        )
        .argument('<id>', 'Sales-led plan ID')
        .action(async function (this: Command, id: string) {
          const opts = this.opts<{ idempotencyKey?: string }>();
          const { data, error, response } = await getClient(this).archive(
            id,
            resolveIdempotency(opts),
          );
          if (error) throw fromApiError(error, response);
          print(data, getFormat(this));
        }),
    ),
    {
      mapsTo: 'POST /v1/sales-led-plans/{id}/archive',
      examples: [
        'cavuno sales-led-plans archive <id> --idempotency-key $(uuidgen)',
      ],
    },
  );
}
