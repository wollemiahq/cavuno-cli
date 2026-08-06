import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';
/**
 * Webhooks surface for the operator API client.
 *
 * - `verifyWebhook` — Standard Webhooks receiver helper (Node-oriented).
 * - `createWebhooksClient` — Operator API facade for webhook endpoint CRUD,
 *   secret rotation, synthetic test delivery (WHK-01), and delivery history
 *   + replay (WHK-02 B3).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Receiver verification ──────────────────────────────────────────────────

const WHSEC_PREFIX = 'whsec_';
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface VerifyWebhookOptions {
  /** Raw request body as received — must be unmodified bytes/string. */
  payload: string | Buffer | Uint8Array;
  /** Value of the `webhook-id` header. */
  id: string;
  /** Value of the `webhook-timestamp` header (unix seconds). */
  timestamp: string | number;
  /** Value of the `webhook-signature` header (`v1,...` space-separated). */
  signature: string;
  /**
   * One or more `whsec_…` secrets (active + overlapping). Every signature is
   * tried against every secret.
   */
  secrets: string | string[];
  /** Max age of the timestamp in seconds. Default 300 (5 minutes). */
  toleranceSeconds?: number;
  /** Override "now" for tests (unix seconds). */
  nowSeconds?: number;
}

export type VerifyWebhookResult = { ok: true } | { ok: false; reason: string };

function toBuffer(payload: string | Buffer | Uint8Array): Buffer {
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  if (Buffer.isBuffer(payload)) return payload;
  return Buffer.from(payload);
}

function decodeWhsec(secret: string): Buffer {
  if (!secret.startsWith(WHSEC_PREFIX)) {
    throw new Error('Webhook secret must start with whsec_');
  }
  return Buffer.from(secret.slice(WHSEC_PREFIX.length), 'base64');
}

function parseSignatures(header: string): string[] {
  // Standard Webhooks: space-separated list of `v1,<base64>` (or versioned) items.
  return header
    .trim()
    .split(/\s+/)
    .map((part) => {
      const comma = part.indexOf(',');
      if (comma === -1) return null;
      const version = part.slice(0, comma);
      const sig = part.slice(comma + 1);
      if (version !== 'v1' || !sig) return null;
      return sig;
    })
    .filter((s): s is string => s !== null);
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Verify a Standard Webhooks delivery.
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, reason }` on failure.
 * Never throws for ordinary verification failures (malformed headers, bad
 * sigs, expired timestamps) so callers can map to 400 uniformly.
 */
export function verifyWebhook(
  options: VerifyWebhookOptions,
): VerifyWebhookResult {
  const {
    id,
    timestamp,
    signature,
    toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = options;

  if (!id || typeof id !== 'string') {
    return { ok: false, reason: 'missing_webhook_id' };
  }
  if (signature == null || String(signature).trim() === '') {
    return { ok: false, reason: 'missing_signature' };
  }

  const ts =
    typeof timestamp === 'number'
      ? timestamp
      : Number.parseInt(String(timestamp), 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const sigs = parseSignatures(String(signature));
  if (sigs.length === 0) {
    return { ok: false, reason: 'malformed_signature_header' };
  }

  const secrets = Array.isArray(options.secrets)
    ? options.secrets
    : [options.secrets];
  if (secrets.length === 0) {
    return { ok: false, reason: 'no_secrets' };
  }

  const body = toBuffer(options.payload);
  const content = `${id}.${ts}.${body.toString('utf8')}`;

  for (const secret of secrets) {
    let key: Buffer;
    try {
      key = decodeWhsec(secret);
    } catch {
      continue;
    }
    const expected = createHmac('sha256', key).update(content).digest('base64');
    for (const sig of sigs) {
      if (safeEqual(expected, sig)) {
        return { ok: true };
      }
    }
  }

  return { ok: false, reason: 'invalid_signature' };
}

// ── Operator endpoint management facade ────────────────────────────────────

type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type WebhookEndpointListQuery =
  paths['/webhook-endpoints']['get']['parameters']['query'];
export type CreateWebhookEndpointBody = JsonBody<
  paths['/webhook-endpoints']['post']
>;
export type UpdateWebhookEndpointBody = JsonBody<
  paths['/webhook-endpoints/{id}']['patch']
>;
export type WebhookDeliveryListQuery =
  paths['/webhook-deliveries']['get']['parameters']['query'];

/**
 * Ergonomic facade for Operator webhook endpoint management (WHK-01) and
 * delivery history + replay (WHK-02 B3).
 *
 * Mutations accept a trailing `IdempotencyOptions` arg (required for endpoint
 * mutations; optional for delivery replay, matching the API's optional
 * Idempotency-Key). Secrets are only present on create and rotate-secret
 * response bodies — never on list/get/update or deliveries.
 */
export function createWebhooksClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idempotencyHeader = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    /** GET /v1/webhook-endpoints — paginated list (no secrets). */
    listWebhookEndpoints: (query?: WebhookEndpointListQuery) =>
      c.GET('/webhook-endpoints', { params: { query: query ?? {} } }),

    /**
     * POST /v1/webhook-endpoints — create endpoint.
     * Response includes the one-time signing `secret` — store immediately.
     */
    createWebhookEndpoint: (
      body: CreateWebhookEndpointBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/webhook-endpoints', {
        body,
        headers: idempotencyHeader(idempotency),
      }),

    /** GET /v1/webhook-endpoints/:id — detail (no secret). */
    getWebhookEndpoint: (id: string) =>
      c.GET('/webhook-endpoints/{id}', { params: { path: { id } } }),

    /** PATCH /v1/webhook-endpoints/:id — update URL, events, or status. */
    updateWebhookEndpoint: (
      id: string,
      body: UpdateWebhookEndpointBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.PATCH('/webhook-endpoints/{id}', {
        params: { path: { id } },
        body,
        headers: idempotencyHeader(idempotency),
      }),

    /** DELETE /v1/webhook-endpoints/:id — soft-retire (config retained for replay). */
    deleteWebhookEndpoint: (id: string, idempotency: IdempotencyOptions) =>
      c.DELETE('/webhook-endpoints/{id}', {
        params: { path: { id } },
        headers: idempotencyHeader(idempotency),
      }),

    /**
     * POST /v1/webhook-endpoints/:id/rotate-secret.
     * Response includes the new one-time signing `secret`.
     */
    rotateWebhookEndpointSecret: (
      id: string,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/webhook-endpoints/{id}/rotate-secret', {
        params: { path: { id } },
        headers: idempotencyHeader(idempotency),
      }),

    /**
     * POST /v1/webhook-endpoints/:id/test — synthetic signed delivery.
     * Returns a sanitized outcome (no payload/response body).
     */
    testWebhookEndpoint: (id: string, idempotency: IdempotencyOptions) =>
      c.POST('/webhook-endpoints/{id}/test', {
        params: { path: { id } },
        headers: idempotencyHeader(idempotency),
      }),

    /**
     * Delivery history + replay (WHK-02 B3).
     * Never exposes lease fields or serialized event bodies.
     */
    deliveries: {
      /** GET /v1/webhook-deliveries — paginated list, newest first. */
      list: (query?: WebhookDeliveryListQuery) =>
        c.GET('/webhook-deliveries', { params: { query: query ?? {} } }),

      /** GET /v1/webhook-deliveries/:id — detail with ordered attempts. */
      get: (id: string) =>
        c.GET('/webhook-deliveries/{id}', { params: { path: { id } } }),

      /**
       * POST /v1/webhook-deliveries/:id/replay — reset a completed delivery.
       * Open (pending/retrying) deliveries return 409.
       */
      replay: (id: string, idempotency?: IdempotencyOptions) =>
        c.POST('/webhook-deliveries/{id}/replay', {
          params: { path: { id } },
          ...(idempotency ? { headers: idempotencyHeader(idempotency) } : {}),
        }),
    },
  };
}

export type WebhooksClient = ReturnType<typeof createWebhooksClient>;
