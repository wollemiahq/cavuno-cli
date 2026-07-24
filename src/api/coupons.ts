import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for Board coupons and promotion codes. Create endpoints
 * require an Idempotency-Key; provider details stay behind the API boundary.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type CreateCouponBody = JsonBody<paths['/coupons']['post']>;
export type RenameCouponBody = JsonBody<paths['/coupons/{id}']['patch']>;
export type CreatePromotionCodeBody = JsonBody<
  paths['/coupons/{id}/promotion-codes']['post']
>;

export function createCouponsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idempotencyHeader = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: () => c.GET('/coupons'),
    get: (id: string) => c.GET('/coupons/{id}', { params: { path: { id } } }),
    create: (body: CreateCouponBody, idempotency: IdempotencyOptions) =>
      c.POST('/coupons', {
        body,
        headers: idempotencyHeader(idempotency),
      }),
    rename: (
      id: string,
      body: RenameCouponBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.PATCH('/coupons/{id}', {
        params: { path: { id } },
        body,
        headers: idempotencyHeader(idempotency),
      }),
    remove: (id: string, idempotency: IdempotencyOptions) =>
      c.DELETE('/coupons/{id}', {
        params: { path: { id } },
        headers: idempotencyHeader(idempotency),
      }),
    createPromotionCode: (
      couponId: string,
      body: CreatePromotionCodeBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/coupons/{id}/promotion-codes', {
        params: { path: { id: couponId } },
        body,
        headers: idempotencyHeader(idempotency),
      }),
    archivePromotionCode: (id: string, idempotency: IdempotencyOptions) =>
      c.POST('/coupons/promotion-codes/{id}/archive', {
        params: { path: { id } },
        headers: idempotencyHeader(idempotency),
      }),
  };
}

export type CouponsClient = ReturnType<typeof createCouponsClient>;
