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

export type DomainListQuery = paths['/domains']['get']['parameters']['query'];

type CreateDomainBody = JsonBody<paths['/domains']['post']>;

export function createDomainsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    list: (query?: DomainListQuery) => c.GET('/domains', { params: { query } }),
    get: (id: string) => c.GET('/domains/{id}', { params: { path: { id } } }),
    add: (body: CreateDomainBody) => c.POST('/domains', { body }),
    verify: (id: string) =>
      c.POST('/domains/{id}/verify', { params: { path: { id } } }),
    remove: (id: string) =>
      c.DELETE('/domains/{id}', { params: { path: { id } } }),
  };
}

export type DomainsClient = ReturnType<typeof createDomainsClient>;
