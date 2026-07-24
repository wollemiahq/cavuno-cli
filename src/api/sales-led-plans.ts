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

export type CreateSalesLedPlanBody = JsonBody<
  paths['/sales-led-plans']['post']
>;
export type UpdateSalesLedPlanBody = JsonBody<
  paths['/sales-led-plans/{id}']['patch']
>;
export type ReorderSalesLedPlansBody = JsonBody<
  paths['/sales-led-plans/reorder']['post']
>;

/**
 * Contact-led employer pricing cards (Operator API).
 *
 * Uses `plans.read` / `plans.manage`. Never exposes accountId, isArchived,
 * storage IDs, or provider fields.
 */
export function createSalesLedPlansClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idem = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    /** GET /v1/sales-led-plans */
    list: () => c.GET('/sales-led-plans', {}),

    /** GET /v1/sales-led-plans/{id} */
    get: (id: string) =>
      c.GET('/sales-led-plans/{id}', { params: { path: { id } } }),

    /**
     * POST /v1/sales-led-plans
     * Requires an Idempotency-Key header.
     */
    create: (
      body: CreateSalesLedPlanBody,
      { idempotencyKey }: IdempotencyOptions,
    ) =>
      c.POST('/sales-led-plans', {
        body,
        headers: idem({ idempotencyKey }),
      }),

    /**
     * PATCH /v1/sales-led-plans/{id}
     * Requires an Idempotency-Key header.
     */
    update: (
      id: string,
      body: UpdateSalesLedPlanBody,
      { idempotencyKey }: IdempotencyOptions,
    ) =>
      c.PATCH('/sales-led-plans/{id}', {
        params: { path: { id } },
        body,
        headers: idem({ idempotencyKey }),
      }),

    /**
     * POST /v1/sales-led-plans/reorder
     * Requires an Idempotency-Key header.
     */
    reorder: (
      body: ReorderSalesLedPlansBody,
      { idempotencyKey }: IdempotencyOptions,
    ) =>
      c.POST('/sales-led-plans/reorder', {
        body,
        headers: idem({ idempotencyKey }),
      }),

    /** POST /v1/sales-led-plans/{id}/publish */
    publish: (id: string, { idempotencyKey }: IdempotencyOptions) =>
      c.POST('/sales-led-plans/{id}/publish', {
        params: { path: { id } },
        headers: idem({ idempotencyKey }),
      }),

    /** POST /v1/sales-led-plans/{id}/hide */
    hide: (id: string, { idempotencyKey }: IdempotencyOptions) =>
      c.POST('/sales-led-plans/{id}/hide', {
        params: { path: { id } },
        headers: idem({ idempotencyKey }),
      }),

    /** POST /v1/sales-led-plans/{id}/archive */
    archive: (id: string, { idempotencyKey }: IdempotencyOptions) =>
      c.POST('/sales-led-plans/{id}/archive', {
        params: { path: { id } },
        headers: idem({ idempotencyKey }),
      }),
  };
}

export type SalesLedPlansClient = ReturnType<typeof createSalesLedPlansClient>;
