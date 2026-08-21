import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

/**
 * Ergonomic facade for the v1 companies domain. Mirrors the jobs facade
 * shape; falls back to loosely-typed body args because the OpenAPI types
 * are regenerated from the public OpenAPI contract
 * against a live dev server. The wire shape is the spec at
 * `docs/api/v1/11-companies.md`.
 */
type AnyBody = Record<string, unknown> | unknown[];

export type CompanyListQuery = Record<string, unknown> & {
  cursor?: string;
  limit?: number;
  search?: string;
};

export function createCompaniesClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  // Untyped helpers — see header comment for typing strategy.
  const get = (path: string, query?: Record<string, unknown>) =>
    (
      c.GET as unknown as (
        p: string,
        o: { params: { query: Record<string, unknown> } },
      ) => Promise<unknown>
    )(path, { params: { query: query ?? {} } });
  const post = (path: string, body?: AnyBody) =>
    (
      c.POST as unknown as (
        p: string,
        o: { body?: AnyBody },
      ) => Promise<unknown>
    )(path, { body });
  const patch = (path: string, body: AnyBody) =>
    (
      c.PATCH as unknown as (
        p: string,
        o: { body: AnyBody },
      ) => Promise<unknown>
    )(path, { body });
  const del = (path: string) =>
    (
      c.DELETE as unknown as (
        p: string,
        o?: Record<string, unknown>,
      ) => Promise<unknown>
    )(path);

  return {
    list: (query?: CompanyListQuery) => get('/companies', query),
    get: (id: string) => get(`/companies/${encodeURIComponent(id)}`),
    create: (body: AnyBody) => post('/companies', body),
    update: (id: string, body: AnyBody) =>
      patch(`/companies/${encodeURIComponent(id)}`, body),
    remove: (id: string) => del(`/companies/${encodeURIComponent(id)}`),
    /** Company blocklist — archive live jobs + stop automated re-import. */
    block: (id: string, body?: { reason?: string }) =>
      post(`/companies/${encodeURIComponent(id)}/block`, body ?? {}),
    /** Remove from company blocklist. Does not republish archived jobs. */
    unblock: (id: string) =>
      post(`/companies/${encodeURIComponent(id)}/unblock`, {}),
    findOrCreate: (body: AnyBody) => post('/companies/find-or-create', body),
    search: (body: AnyBody) => post('/companies/search', body),
    batch: (body: AnyBody) => post('/companies/batch', body),
    listJobs: (
      id: string,
      query?: { cursor?: string; limit?: number; status?: string },
    ) => get(`/companies/${encodeURIComponent(id)}/jobs`, query),
    deleteLogo: (id: string) =>
      del(`/companies/${encodeURIComponent(id)}/logo`),
    /**
     * Multipart logo upload. The base openapi-fetch client doesn't help
     * here — callers pass a fully-formed Request body (FormData or Blob).
     */
    uploadLogo: async (id: string, formData: FormData) => {
      const url = `${opts.baseUrl ?? ''}/companies/${encodeURIComponent(id)}/logo`;
      const headers: Record<string, string> = {};
      if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;
      if (opts.accountId) headers['X-Cavuno-Account'] = opts.accountId;
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = response.ok ? await response.json() : null;
      const error = response.ok
        ? null
        : await response.json().catch(() => null);
      return { data, error, response };
    },
  };
}

export type CompaniesClient = ReturnType<typeof createCompaniesClient>;
