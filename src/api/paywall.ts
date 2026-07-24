import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

type Query<P> = P extends {
  parameters?: { query?: infer Q };
}
  ? Q
  : never;

export type PutCandidatePaywallBody = JsonBody<paths['/paywall']['put']>;
export type ListCandidatePaywallSubscriptionsQuery = Query<
  paths['/paywall/subscriptions']['get']
>;

/**
 * Atomic candidate-access paywall (Operator API).
 *
 * Never exposes Stripe product, price, portal, customer, or subscription
 * identifiers — only product configuration and subscription state.
 */
export function createPaywallClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idem = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    /** GET /v1/paywall */
    get: () => c.GET('/paywall', {}),

    /**
     * PUT /v1/paywall — complete atomic replace.
     * Requires an Idempotency-Key header.
     */
    replace: (
      body: PutCandidatePaywallBody,
      { idempotencyKey }: IdempotencyOptions,
    ) =>
      c.PUT('/paywall', {
        body,
        headers: idem({ idempotencyKey }),
      }),

    /** GET /v1/paywall/subscriptions */
    listSubscriptions: (query?: ListCandidatePaywallSubscriptionsQuery) =>
      c.GET('/paywall/subscriptions', { params: { query } }),
  };
}

export type PaywallClient = ReturnType<typeof createPaywallClient>;
