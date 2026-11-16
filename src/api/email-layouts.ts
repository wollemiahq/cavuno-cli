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

export type CreateEmailLayoutBody = JsonBody<paths['/email-layouts']['post']>;
export type UpdateEmailLayoutDraftBody = JsonBody<
  paths['/email-layouts/{id}/draft']['put']
>;
export type EmailLayoutVersionListQuery =
  paths['/email-layouts/{id}/versions']['get']['parameters']['query'];
type DuplicateEmailLayoutBody = JsonBody<
  paths['/email-layouts/{id}/duplicate']['post']
>;
type TestEmailLayoutBody = JsonBody<paths['/email-layouts/{id}/test']['post']>;

/** Email templates. `system` names the board's System template. */
export function createEmailLayoutsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const path = (id: string) => ({ params: { path: { id } } });

  return {
    list: () => c.GET('/email-layouts'),
    get: (id: string) => c.GET('/email-layouts/{id}', path(id)),
    create: (body: CreateEmailLayoutBody) => c.POST('/email-layouts', { body }),
    rename: (id: string, name: string) =>
      c.PATCH('/email-layouts/{id}', { ...path(id), body: { name } }),
    remove: (id: string) => c.DELETE('/email-layouts/{id}', path(id)),
    duplicate: (id: string, body: DuplicateEmailLayoutBody = {}) =>
      c.POST('/email-layouts/{id}/duplicate', { ...path(id), body }),
    updateDraft: (id: string, body: UpdateEmailLayoutDraftBody) =>
      c.PUT('/email-layouts/{id}/draft', { ...path(id), body }),
    publish: (id: string) => c.POST('/email-layouts/{id}/publish', path(id)),
    listVersions: (id: string, query?: EmailLayoutVersionListQuery) =>
      c.GET('/email-layouts/{id}/versions', {
        params: { path: { id }, query },
      }),
    getVersion: (id: string, versionId: string) =>
      c.GET('/email-layouts/{id}/versions/{versionId}', {
        params: { path: { id, versionId } },
      }),
    restoreVersion: (id: string, versionId: string, baseRevision: number) =>
      c.POST('/email-layouts/{id}/versions/{versionId}/restore', {
        params: { path: { id, versionId } },
        body: { baseRevision },
      }),
    test: (id: string, body: TestEmailLayoutBody) =>
      c.POST('/email-layouts/{id}/test', { ...path(id), body }),
  };
}

export type EmailLayoutsClient = ReturnType<typeof createEmailLayoutsClient>;
