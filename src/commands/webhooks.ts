import { Command } from 'commander';

import { createWebhooksClient } from '../api/webhooks.js';
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
  return createWebhooksClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
}

function parseIntArg(flag: string, min: number, max: number) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      console.error(`${flag}: expected an integer, got ${raw}`);
      process.exit(2);
    }
    if (n < min || n > max) {
      console.error(
        `${flag}: expected an integer from ${min} to ${max}, got ${raw}`,
      );
      process.exit(2);
    }
    return n;
  };
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

function parseEventTypes(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    console.error('--event-types: expected at least one event type');
    process.exit(2);
  }
  return parts;
}

/**
 * Print create/rotate responses with a clear one-time-secret notice.
 * The secret field is only present on those responses.
 */
function printWithSecretNotice(
  data: unknown,
  format: OutputFormat,
  kind: 'created' | 'rotated',
): void {
  print(data, format);
  const secret =
    data &&
    typeof data === 'object' &&
    'secret' in data &&
    typeof (data as { secret: unknown }).secret === 'string'
      ? (data as { secret: string }).secret
      : data &&
          typeof data === 'object' &&
          'data' in data &&
          (data as { data: unknown }).data &&
          typeof (data as { data: unknown }).data === 'object' &&
          'secret' in ((data as { data: Record<string, unknown> }).data ?? {})
        ? String((data as { data: { secret: string } }).data.secret)
        : null;

  if (secret) {
    console.error('');
    console.error(
      kind === 'created'
        ? 'Store this signing secret now — Cavuno will not show it again.'
        : 'Store this new signing secret now — Cavuno will not show it again. The previous secret remains valid for a short overlap window.',
    );
  }
}

const DELIVERY_STATUSES = [
  'pending',
  'retrying',
  'delivered',
  'terminal',
  'exhausted',
] as const;

type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

function parseDeliveryStatus(raw: string): DeliveryStatus {
  if (!(DELIVERY_STATUSES as readonly string[]).includes(raw)) {
    console.error(
      `--status: expected one of ${DELIVERY_STATUSES.join(', ')}, got ${raw}`,
    );
    process.exit(2);
  }
  return raw as DeliveryStatus;
}

export function registerWebhooksCommand(root: Command): void {
  const webhooks = root
    .command('webhooks')
    .description(
      'Manage Board-owned webhook endpoints and inspect delivery history.',
    );

  const endpoints = webhooks
    .command('endpoints')
    .description('Manage webhook endpoints for the authenticated account.');

  annotate(
    endpoints
      .command('list')
      .description('List webhook endpoints.')
      .option(
        '--limit <n>',
        'Page size 1-100 (default 50)',
        parseIntArg('--limit', 1, 100),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ limit?: number; cursor?: string }>();
        const r = unwrap(await client.listWebhookEndpoints(opts));
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          format,
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/webhook-endpoints',
      examples: ['cavuno webhooks endpoints list'],
    },
  );

  annotate(
    endpoints
      .command('get')
      .description('Fetch a webhook endpoint by ID.')
      .argument('<id>', 'Endpoint ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.getWebhookEndpoint(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/webhook-endpoints/:id',
      examples: ['cavuno webhooks endpoints get whe_123'],
    },
  );

  annotate(
    withIdempotencyOption(
      endpoints
        .command('create')
        .description(
          'Create a webhook endpoint. Prints the one-time signing secret once.',
        )
        .requiredOption(
          '--url <url>',
          'Public HTTPS URL that will receive deliveries',
        )
        .requiredOption(
          '--event-types <types>',
          'Comma-separated V1 event types (e.g. job.created,company.updated)',
        ),
    ).action(async function (this: Command) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<
        IdempotencyOptions & {
          url: string;
          eventTypes: string;
        }
      >();
      const event_types = parseEventTypes(opts.eventTypes)!;
      const r = unwrap(
        await client.createWebhookEndpoint(
          {
            url: opts.url,
            // CLI accepts free-form CSV; API zod rejects unknown types.
            event_types: event_types as never,
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      printWithSecretNotice(r.data, format, 'created');
    }),
    {
      mapsTo: 'POST /v1/webhook-endpoints',
      examples: [
        'cavuno webhooks endpoints create --url https://hooks.example.com/cavuno --event-types job.created,job.updated',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      endpoints
        .command('update')
        .description('Update a webhook endpoint (URL, event types, or status).')
        .argument('<id>', 'Endpoint ID')
        .option('--url <url>', 'New HTTPS destination URL')
        .option(
          '--event-types <types>',
          'Comma-separated V1 event types replacing the current selection',
        )
        .option('--status <status>', 'enabled or paused', (raw) => {
          if (raw !== 'enabled' && raw !== 'paused') {
            console.error('--status: expected enabled or paused');
            process.exit(2);
          }
          return raw as 'enabled' | 'paused';
        }),
    ).action(async function (this: Command, id: string) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<
        IdempotencyOptions & {
          url?: string;
          eventTypes?: string;
          status?: 'enabled' | 'paused';
        }
      >();
      const body: {
        url?: string;
        event_types?: string[];
        status?: 'enabled' | 'paused';
      } = {};
      if (opts.url !== undefined) body.url = opts.url;
      if (opts.eventTypes !== undefined) {
        body.event_types = parseEventTypes(opts.eventTypes) as never;
      }
      if (opts.status !== undefined) body.status = opts.status;

      if (Object.keys(body).length === 0) {
        console.error(
          'update: pass at least one of --url, --event-types, or --status',
        );
        process.exit(2);
      }

      const r = unwrap(
        await client.updateWebhookEndpoint(
          id,
          body as never,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: 'PATCH /v1/webhook-endpoints/:id',
      examples: [
        'cavuno webhooks endpoints update whe_123 --status paused',
        'cavuno webhooks endpoints update whe_123 --url https://hooks.example.com/v2',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        endpoints
          .command('delete')
          .description(
            'Retire a webhook endpoint (stops future delivery; keeps config for replay).',
          )
          .argument('<id>', 'Endpoint ID'),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions & IdempotencyOptions>();
      await confirmOrAbort({
        message: `Retire webhook endpoint ${id}? Open deliveries will be cancelled; config is retained for historical replay.`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(
        await client.deleteWebhookEndpoint(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/webhook-endpoints/:id',
      examples: ['cavuno webhooks endpoints delete whe_123 --yes'],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        endpoints
          .command('rotate-secret')
          .description('Rotate the signing secret. Prints the new secret once.')
          .argument('<id>', 'Endpoint ID'),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions & IdempotencyOptions>();
      await confirmOrAbort({
        message: `Rotate the signing secret for webhook endpoint ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const format = getFormat(this);
      const r = unwrap(
        await client.rotateWebhookEndpointSecret(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      printWithSecretNotice(r.data, format, 'rotated');
    }),
    {
      mapsTo: 'POST /v1/webhook-endpoints/:id/rotate-secret',
      examples: ['cavuno webhooks endpoints rotate-secret whe_123 --yes'],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        endpoints
          .command('test')
          .description(
            'Send one synthetic signed test delivery to the endpoint URL.',
          )
          .argument('<id>', 'Endpoint ID'),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions & IdempotencyOptions>();
      await confirmOrAbort({
        message: `Send a synthetic test delivery to webhook endpoint ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const format = getFormat(this);
      const r = unwrap(
        await client.testWebhookEndpoint(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: 'POST /v1/webhook-endpoints/:id/test',
      examples: ['cavuno webhooks endpoints test whe_123 --yes'],
    },
  );

  const deliveries = webhooks
    .command('deliveries')
    .description(
      'Inspect webhook delivery history and replay completed deliveries.',
    );

  annotate(
    deliveries
      .command('list')
      .description('List webhook deliveries (newest first).')
      .option('--endpoint <id>', 'Filter to a single endpoint ID')
      .option(
        '--status <status>',
        `Filter by status (${DELIVERY_STATUSES.join('|')})`,
        parseDeliveryStatus,
      )
      .option(
        '--limit <n>',
        'Page size 1-100 (default 50)',
        parseIntArg('--limit', 1, 100),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          endpoint?: string;
          status?: DeliveryStatus;
          limit?: number;
          cursor?: string;
        }>();
        const query: {
          endpoint_id?: string;
          status?: DeliveryStatus;
          limit?: number;
          cursor?: string;
        } = {};
        if (opts.endpoint !== undefined) query.endpoint_id = opts.endpoint;
        if (opts.status !== undefined) query.status = opts.status;
        if (opts.limit !== undefined) query.limit = opts.limit;
        if (opts.cursor !== undefined) query.cursor = opts.cursor;

        const r = unwrap(await client.deliveries.list(query));
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          format,
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/webhook-deliveries',
      examples: [
        'cavuno webhooks deliveries list',
        'cavuno webhooks deliveries list --endpoint whe_123 --status delivered',
      ],
    },
  );

  annotate(
    deliveries
      .command('get')
      .description('Fetch a webhook delivery by ID (includes attempt history).')
      .argument('<id>', 'Delivery ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.deliveries.get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/webhook-deliveries/:id',
      examples: ['cavuno webhooks deliveries get wdl_123'],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        deliveries
          .command('replay')
          .description(
            'Replay a completed delivery (delivered/terminal/exhausted). Reuses frozen event bytes with a fresh signature. Exhausted deliveries get one fresh attempt, not a fresh retry budget. Open (pending/retrying) deliveries return 409.',
          )
          .argument('<id>', 'Delivery ID'),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions & IdempotencyOptions>();
      await confirmOrAbort({
        message: `Replay webhook delivery ${id}? This reuses the frozen event bytes and signs a fresh attempt. Exhausted deliveries get one attempt, not a fresh retry budget.`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const format = getFormat(this);
      const r = unwrap(
        await client.deliveries.replay(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: 'POST /v1/webhook-deliveries/:id/replay',
      examples: ['cavuno webhooks deliveries replay wdl_123 --yes'],
    },
  );
}
