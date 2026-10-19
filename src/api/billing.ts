import {
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 billing surfaces:
 * - Reads: own-account subscription and Connect status
 * - Writes: hosted checkout, guarded plan upgrade, Connect onboarding link
 *
 * Wire shape:  §1 (funding union) + §5.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type BillingCheckoutBody = JsonBody<paths['/billing/checkout']['post']>;
export type BillingUpgradeBody = JsonBody<paths['/billing/upgrade']['post']>;

export function createBillingClient(opts: CavunoClientOptions) {
  const c = createCavunoClient(opts);
  const idem = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    getSubscription: () => c.GET('/billing/subscription'),
    getConnect: () => c.GET('/billing/connect'),

    /**
     * POST /v1/billing/connect/onboarding-link — single-use hosted Stripe
     * onboarding URL for a human; expires within minutes.
     */
    postConnectOnboardingLink: () => c.POST('/billing/connect/onboarding-link'),

    /** POST /v1/billing/checkout — hosted Checkout Session URL. */
    postCheckout: (body: BillingCheckoutBody) =>
      c.POST('/billing/checkout', { body }),

    /**
     * POST /v1/billing/upgrade — headless upgrade or hosted fallback.
     * Requires an Idempotency-Key (money mutation).
     */
    postUpgrade: (
      body: BillingUpgradeBody,
      { idempotencyKey }: IdempotencyOptions,
    ) =>
      c.POST('/billing/upgrade', {
        body,
        headers: idem({ idempotencyKey }),
      }),
  };
}

export type BillingClient = ReturnType<typeof createBillingClient>;
