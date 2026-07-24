import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for tenant-admin employer-plans CRUD. These are
 * the plans a board operator sells to employers — not the operator's own
 * platform subscription (see `createBillingClient`). Wire shape:
 * `docs/api/v1/22-billing.md` Plans section (single-price model).
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type CreatePlanBody = JsonBody<paths['/plans']['post']>;
export type UpdatePlanBody = JsonBody<paths['/plans/{id}']['patch']>;
export type SetPlanPriceBody = JsonBody<paths['/plans/{id}/price']['put']>;
export type SetPlanFeaturesBody = JsonBody<
  paths['/plans/{id}/features']['put']
>;

export function createPlansClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idempotencyHeader = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: () => c.GET('/plans'),
    get: (id: string) => c.GET('/plans/{id}', { params: { path: { id } } }),
    create: (body: CreatePlanBody, idempotency?: IdempotencyOptions) =>
      c.POST('/plans', {
        body,
        ...(idempotency ? { headers: idempotencyHeader(idempotency) } : {}),
      }),
    update: (
      id: string,
      body: UpdatePlanBody,
      idempotency?: IdempotencyOptions,
    ) =>
      c.PATCH('/plans/{id}', {
        params: { path: { id } },
        body,
        ...(idempotency ? { headers: idempotencyHeader(idempotency) } : {}),
      }),
    /** Publish the plan's checkout price — Idempotency-Key required. */
    setPrice: (
      id: string,
      body: SetPlanPriceBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.PUT('/plans/{id}/price', {
        params: { path: { id } },
        body,
        headers: idempotencyHeader(idempotency),
      }),
    getFeatures: (id: string) =>
      c.GET('/plans/{id}/features', { params: { path: { id } } }),
    setFeatures: (
      id: string,
      body: SetPlanFeaturesBody,
      idempotency?: IdempotencyOptions,
    ) =>
      c.PUT('/plans/{id}/features', {
        params: { path: { id } },
        body,
        ...(idempotency ? { headers: idempotencyHeader(idempotency) } : {}),
      }),
  };
}

export type PlansClient = ReturnType<typeof createPlansClient>;
