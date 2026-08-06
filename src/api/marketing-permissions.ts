import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

type Query<P> = P extends {
  parameters?: { query?: infer Q };
}
  ? Q
  : never;

export type MarketingPermissionsListQuery = Query<
  paths['/marketing-permissions']['get']
>;

/**
 * Operator reads and withdrawal for marketing consent, which lives on the
 * board user record. There is deliberately no grant operation: granting is
 * person-authoritative and exists only on Board-user surfaces that display
 * the board-authored disclosure wording.
 */
export function createMarketingPermissionsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    /** GET /v1/marketing-permissions — every recorded consent decision. */
    list: (query?: MarketingPermissionsListQuery) =>
      c.GET('/marketing-permissions', {
        params: { query: query ?? {} },
      }),

    /** POST /v1/marketing-permissions/:id/withdraw — operator withdrawal. */
    withdraw: (boardUserId: string, idempotency: IdempotencyOptions) =>
      c.POST('/marketing-permissions/{id}/withdraw', {
        params: { path: { id: boardUserId } },
        headers: { 'Idempotency-Key': idempotency.idempotencyKey },
      }),
  };
}

export type MarketingPermissionsClient = ReturnType<
  typeof createMarketingPermissionsClient
>;
