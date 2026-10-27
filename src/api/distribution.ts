import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 distribution domain: XML feeds of the board's
 * published jobs for job aggregators, the origin their URLs live on, and
 * the Cavuno distribution opt-in. Writes take an optional trailing
 * `IdempotencyOptions` arg — the routes have `idempotency.required: false`.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type CreateDistributionFeedBody = JsonBody<
  paths['/distribution/feeds']['post']
>;
export type UpdateDistributionFeedBody = JsonBody<
  paths['/distribution/feeds/{id}']['patch']
>;
export type UpdateDistributionSettingsBody = JsonBody<
  paths['/distribution/settings']['patch']
>;

export function createDistributionClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const headers = (idempotency?: IdempotencyOptions) =>
    idempotency
      ? { headers: { 'Idempotency-Key': idempotency.idempotencyKey } }
      : {};

  return {
    listFeeds: () => c.GET('/distribution/feeds'),
    getFeed: (id: string) =>
      c.GET('/distribution/feeds/{id}', { params: { path: { id } } }),
    createFeed: (
      body: CreateDistributionFeedBody,
      idempotency?: IdempotencyOptions,
    ) => c.POST('/distribution/feeds', { body, ...headers(idempotency) }),
    updateFeed: (
      id: string,
      body: UpdateDistributionFeedBody,
      idempotency?: IdempotencyOptions,
    ) =>
      c.PATCH('/distribution/feeds/{id}', {
        params: { path: { id } },
        body,
        ...headers(idempotency),
      }),
    removeFeed: (id: string, idempotency?: IdempotencyOptions) =>
      c.DELETE('/distribution/feeds/{id}', {
        params: { path: { id } },
        ...headers(idempotency),
      }),
    getFeedOrigin: () => c.GET('/distribution/feed-origin'),
    acknowledgeFeedOrigin: (idempotency?: IdempotencyOptions) =>
      c.POST('/distribution/feed-origin/acknowledge', headers(idempotency)),
    getSettings: () => c.GET('/distribution/settings'),
    updateSettings: (
      body: UpdateDistributionSettingsBody,
      idempotency?: IdempotencyOptions,
    ) => c.PATCH('/distribution/settings', { body, ...headers(idempotency) }),
  };
}

export type DistributionClient = ReturnType<typeof createDistributionClient>;
