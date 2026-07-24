import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 redirects domain. `create`, `update`, and
 * `remove` take a trailing `IdempotencyOptions` arg (required), matching the
 * subscribers facade. Batch idempotency is optional — the batch route has
 * `idempotency.required: false`. Wire shape: `docs/api/v1/15-pages.md` §
 * Redirects.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type RedirectListQuery =
  paths['/redirects']['get']['parameters']['query'];
export type CreateRedirectBody = JsonBody<paths['/redirects']['post']>;
export type UpdateRedirectBody = JsonBody<paths['/redirects/{id}']['patch']>;
export type RedirectBatchBody = JsonBody<paths['/redirects/batch']['post']>;

export function createRedirectsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idempotencyHeader = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: (query?: RedirectListQuery) =>
      c.GET('/redirects', { params: { query: query ?? {} } }),
    create: (body: CreateRedirectBody, idempotency: IdempotencyOptions) =>
      c.POST('/redirects', { body, headers: idempotencyHeader(idempotency) }),
    update: (
      id: string,
      body: UpdateRedirectBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.PATCH('/redirects/{id}', {
        params: { path: { id } },
        body,
        headers: idempotencyHeader(idempotency),
      }),
    remove: (id: string, idempotency: IdempotencyOptions) =>
      c.DELETE('/redirects/{id}', {
        params: { path: { id } },
        headers: idempotencyHeader(idempotency),
      }),
    batch: (body: RedirectBatchBody, idempotency?: IdempotencyOptions) =>
      c.POST('/redirects/batch', {
        body,
        ...(idempotency ? { headers: idempotencyHeader(idempotency) } : {}),
      }),
  };
}

export type RedirectsClient = ReturnType<typeof createRedirectsClient>;
