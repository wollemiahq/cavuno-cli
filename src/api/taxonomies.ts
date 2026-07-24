import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

/**
 * Taxonomies facade — remote helpers + operator CRUD (skills / categories /
 * markets). Loosely typed until OpenAPI types are regenerated post-merge.
 */
type AnyBody = Record<string, unknown> | unknown[];
type ListQuery = Record<string, unknown> & {
  cursor?: string;
  limit?: number;
  search?: string;
  parentId?: string;
};

export function createTaxonomiesClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const get = (path: string, query?: Record<string, unknown>) =>
    (
      c.GET as unknown as (
        p: string,
        o?: { params?: { query?: Record<string, unknown> } },
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>
    )(path, query ? { params: { query } } : undefined);
  const post = (path: string, body?: AnyBody) =>
    (
      c.POST as unknown as (
        p: string,
        o: { body?: AnyBody },
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>
    )(path, { body });
  const patch = (path: string, body: AnyBody) =>
    (
      c.PATCH as unknown as (
        p: string,
        o: { body: AnyBody },
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>
    )(path, { body });
  const del = (path: string) =>
    (
      c.DELETE as unknown as (
        p: string,
        o?: Record<string, unknown>,
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>
    )(path);

  const enc = encodeURIComponent;

  return {
    // ── Public helpers ──
    remotePermits: () => get('/taxonomies/remote-permits'),
    remoteTimezones: () => get('/taxonomies/remote-timezones'),

    // ── Skills ──
    skillsList: (query?: ListQuery) => get('/taxonomies/skills', query),
    skillsGet: (id: string) => get(`/taxonomies/skills/${enc(id)}`),
    skillsCreate: (body: AnyBody) => post('/taxonomies/skills', body),
    skillsUpdate: (id: string, body: AnyBody) =>
      patch(`/taxonomies/skills/${enc(id)}`, body),
    skillsDelete: (id: string) => del(`/taxonomies/skills/${enc(id)}`),
    skillsAddAliases: (id: string, body: { aliases: string[] }) =>
      post(`/taxonomies/skills/${enc(id)}/aliases`, body),
    skillsRemoveAlias: (id: string, alias: string) =>
      del(`/taxonomies/skills/${enc(id)}/aliases/${enc(alias)}`),

    // ── Categories ──
    categoriesList: (query?: ListQuery) => get('/taxonomies/categories', query),
    categoriesTree: () => get('/taxonomies/categories/tree'),
    categoriesGet: (id: string) => get(`/taxonomies/categories/${enc(id)}`),
    categoriesCreate: (body: AnyBody) => post('/taxonomies/categories', body),
    categoriesUpdate: (id: string, body: AnyBody) =>
      patch(`/taxonomies/categories/${enc(id)}`, body),
    categoriesDelete: (id: string) => del(`/taxonomies/categories/${enc(id)}`),
    categoriesAddAliases: (id: string, body: { aliases: string[] }) =>
      post(`/taxonomies/categories/${enc(id)}/aliases`, body),
    categoriesRemoveAlias: (id: string, alias: string) =>
      del(`/taxonomies/categories/${enc(id)}/aliases/${enc(alias)}`),

    // ── Markets ──
    marketsList: (query?: ListQuery) => get('/taxonomies/markets', query),
    marketsGet: (id: string) => get(`/taxonomies/markets/${enc(id)}`),
    marketsCreate: (body: AnyBody) => post('/taxonomies/markets', body),
    marketsUpdate: (id: string, body: AnyBody) =>
      patch(`/taxonomies/markets/${enc(id)}`, body),
    marketsDelete: (id: string) => del(`/taxonomies/markets/${enc(id)}`),
    marketsAddAliases: (id: string, body: { aliases: string[] }) =>
      post(`/taxonomies/markets/${enc(id)}/aliases`, body),
    marketsRemoveAlias: (id: string, alias: string) =>
      del(`/taxonomies/markets/${enc(id)}/aliases/${enc(alias)}`),
  };
}

export type TaxonomiesClient = ReturnType<typeof createTaxonomiesClient>;
