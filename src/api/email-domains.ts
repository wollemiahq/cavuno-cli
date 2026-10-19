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

type CreateEmailDomainBody = JsonBody<paths['/email-domains']['post']>;
type UpdateEmailDomainBody = JsonBody<paths['/email-domains/{id}']['patch']>;

export function createEmailDomainsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    list: () => c.GET('/email-domains'),
    get: (id: string) =>
      c.GET('/email-domains/{id}', { params: { path: { id } } }),
    add: (body: CreateEmailDomainBody) => c.POST('/email-domains', { body }),
    update: (id: string, body: UpdateEmailDomainBody) =>
      c.PATCH('/email-domains/{id}', { params: { path: { id } }, body }),
    verify: (id: string) =>
      c.POST('/email-domains/{id}/verify', { params: { path: { id } } }),
    remove: (id: string) =>
      c.DELETE('/email-domains/{id}', { params: { path: { id } } }),
  };
}

export type EmailDomainsClient = ReturnType<typeof createEmailDomainsClient>;
