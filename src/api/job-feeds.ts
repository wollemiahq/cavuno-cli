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

export type JobFeedListQuery =
  paths['/job-feeds']['get']['parameters']['query'];
export type JobFeedRunListQuery =
  paths['/job-feeds/{id}/runs']['get']['parameters']['query'];
export type CreateJobFeedBody = JsonBody<paths['/job-feeds']['post']>;
export type UpdateJobFeedBody = JsonBody<paths['/job-feeds/{id}']['patch']>;

/**
 * Recurring XML job feeds (Operator API, `imports.read` / `imports.manage`).
 * The mapping is review state on the feed: it is detected by the first run
 * (the feed reads `pending_mapping` until then) and edited through `update`.
 * Mutations forward an optional `Idempotency-Key`.
 */
export function createJobFeedsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idem = (idempotency?: IdempotencyOptions) =>
    idempotency ? { 'Idempotency-Key': idempotency.idempotencyKey } : {};

  return {
    list: (query?: JobFeedListQuery) =>
      c.GET('/job-feeds', { params: { query } }),
    get: (id: string) => c.GET('/job-feeds/{id}', { params: { path: { id } } }),
    create: (body: CreateJobFeedBody, idempotency?: IdempotencyOptions) =>
      c.POST('/job-feeds', { body, headers: idem(idempotency) }),
    update: (
      id: string,
      body: UpdateJobFeedBody,
      idempotency?: IdempotencyOptions,
    ) =>
      c.PATCH('/job-feeds/{id}', {
        params: { path: { id } },
        body,
        headers: idem(idempotency),
      }),
    delete: (id: string, idempotency?: IdempotencyOptions) =>
      c.DELETE('/job-feeds/{id}', {
        params: { path: { id } },
        headers: idem(idempotency),
      }),
    redetectMapping: (id: string, idempotency?: IdempotencyOptions) =>
      c.POST('/job-feeds/{id}/redetect-mapping', {
        params: { path: { id } },
        headers: idem(idempotency),
      }),
    listRuns: (id: string, query?: JobFeedRunListQuery) =>
      c.GET('/job-feeds/{id}/runs', { params: { path: { id }, query } }),
  };
}

export type JobFeedsClient = ReturnType<typeof createJobFeedsClient>;
