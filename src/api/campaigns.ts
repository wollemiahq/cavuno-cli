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

export type CreateCampaignBody = JsonBody<paths['/campaigns']['post']>;
export type UpdateCampaignBody = JsonBody<paths['/campaigns/{id}']['patch']>;
export type ListCampaignsQuery = NonNullable<
  paths['/campaigns']['get']['parameters']['query']
>;

/** One-off emails to your board's contacts: drafts, tests and checks. */
export function createCampaignsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const path = (id: string) => ({ params: { path: { id } } });

  return {
    list: (query: ListCampaignsQuery = {}) =>
      c.GET('/campaigns', { params: { query } }),
    get: (id: string) => c.GET('/campaigns/{id}', path(id)),
    create: (body: CreateCampaignBody = {}) => c.POST('/campaigns', { body }),
    update: (id: string, body: UpdateCampaignBody) =>
      c.PATCH('/campaigns/{id}', { ...path(id), body }),
    delete: (id: string) => c.DELETE('/campaigns/{id}', path(id)),
    duplicate: (id: string) => c.POST('/campaigns/{id}/duplicate', path(id)),
    test: (id: string) => c.POST('/campaigns/{id}/test', path(id)),
    verify: (id: string) => c.POST('/campaigns/{id}/verify', path(id)),
  };
}

export type CampaignsClient = ReturnType<typeof createCampaignsClient>;
