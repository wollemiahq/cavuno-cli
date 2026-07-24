import {
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 candidates domain. Request paths and
 * queries are derived from the generated OpenAPI contract. Wire shape:
 * `docs/api/v1/21-candidates-employers.md`.
 *
 * `remove` is the GDPR cascade delete — it returns `202` with a
 * `candidates.remove` operation to poll (see the operations client).
 * `GET /v1/candidates/count` is deliberately not exposed yet (deferred with the
 * endpoint itself — it needs a role-scoped aggregate).
 */
type GeneratedCandidateListQuery =
  paths['/candidates']['get']['parameters']['query'];

export type CandidateListQuery = Omit<
  GeneratedCandidateListQuery,
  'hasResume'
> & {
  hasResume?: boolean;
};

export function createCandidatesClient(opts: CavunoClientOptions) {
  const c = createCavunoClient(opts);

  return {
    list: (query?: CandidateListQuery) => {
      const { hasResume, ...rest } = query ?? {};
      return c.GET('/candidates', {
        params: {
          query: {
            ...rest,
            ...(hasResume !== undefined
              ? { hasResume: hasResume ? 'true' : 'false' }
              : {}),
          },
        },
      });
    },
    get: (id: string) =>
      c.GET('/candidates/{id}', { params: { path: { id } } }),
    downloadResume: (id: string) =>
      c.GET('/candidates/{id}/resume', {
        params: { path: { id } },
        parseAs: 'arrayBuffer',
      }),
    remove: (id: string, { idempotencyKey }: IdempotencyOptions) =>
      c.DELETE('/candidates/{id}', {
        params: { path: { id } },
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
  };
}

export type CandidatesClient = ReturnType<typeof createCandidatesClient>;
