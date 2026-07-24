import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

type CreateJobBody = JsonBody<paths['/jobs']['post']>;
type UpdateJobBody = JsonBody<paths['/jobs/{id}']['patch']>;
type SearchJobsBody = JsonBody<paths['/jobs/search']['post']>;
type BatchJobsBody = JsonBody<paths['/jobs/batch']['post']>;
type ListJobsQuery = paths['/jobs']['get']['parameters']['query'];

/**
 * Ergonomic facade over the raw `openapi-fetch` client for the jobs
 * domain. Used by the Cavuno CLI. Future
 * domains will get their own facade modules (`./companies`, etc.) as
 * each API surface lands.
 *
 * Returns the `{ data, error, response }` envelope from `openapi-fetch`
 * — consumers branch on `error` first, then use `data` typed to the
 * spec's success-response shape.
 */
export function createJobsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    /** GET /v1/jobs — paginated list with optional filter. */
    list: (query?: ListJobsQuery) =>
      c.GET('/jobs', { params: { query: query ?? {} } }),

    /** GET /v1/jobs/:id — single job, enriched. */
    get: (id: string) => c.GET('/jobs/{id}', { params: { path: { id } } }),

    /** POST /v1/jobs — create a draft. */
    create: (body: CreateJobBody) => c.POST('/jobs', { body }),

    /** PATCH /v1/jobs/:id — partial update. */
    update: (id: string, body: UpdateJobBody) =>
      c.PATCH('/jobs/{id}', { params: { path: { id } }, body }),

    /** DELETE /v1/jobs/:id — hard delete. */
    remove: (id: string) =>
      c.DELETE('/jobs/{id}', { params: { path: { id } } }),

    /** POST /v1/jobs/:id/publish — transition to published. */
    publish: (id: string, body?: { expiresAt?: string | null }) =>
      c.POST('/jobs/{id}/publish', {
        params: { path: { id } },
        body: body ?? {},
      }),

    /** POST /v1/jobs/:id/pause — published → draft. */
    pause: (id: string) =>
      c.POST('/jobs/{id}/pause', { params: { path: { id } } }),

    /** POST /v1/jobs/:id/expire — published → expired (sets expiresAt = now). */
    expire: (id: string) =>
      c.POST('/jobs/{id}/expire', { params: { path: { id } } }),

    /** POST /v1/jobs/:id/duplicate — copy to a new draft. */
    duplicate: (id: string) =>
      c.POST('/jobs/{id}/duplicate', {
        params: { path: { id } },
        body: {},
      }),

    /** POST /v1/jobs/search — rich-filter search. */
    search: (body: SearchJobsBody) => c.POST('/jobs/search', { body }),

    /** POST /v1/jobs/batch — bulk operations. */
    batch: (body: BatchJobsBody) => c.POST('/jobs/batch', { body }),
  };
}

export type JobsClient = ReturnType<typeof createJobsClient>;
