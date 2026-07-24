import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

/**
 * Ergonomic facade for the by-ID async-operation monitor. Loose-typed like
 * the blog facade — several operation responses only declare 200 in OpenAPI,
 * so openapi-fetch would otherwise type `error` as `never`.
 */
type AnyQuery = Record<string, unknown>;

export function createOperationsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const getById = (path: string, id: string, query?: AnyQuery) =>
    (
      c.GET as unknown as (
        p: string,
        o: { params: { path: { id: string }; query?: AnyQuery } },
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>
    )(path, { params: { path: { id }, query } });
  const postById = (path: string, id: string) =>
    (
      c.POST as unknown as (
        p: string,
        o: { params: { path: { id: string } } },
      ) => Promise<{ data?: unknown; error?: unknown; response: Response }>
    )(path, { params: { path: { id } } });

  return {
    get: (id: string) => getById('/operations/{id}', id),
    cancel: (id: string) => postById('/operations/{id}/cancel', id),
  };
}

export type OperationsClient = ReturnType<typeof createOperationsClient>;
