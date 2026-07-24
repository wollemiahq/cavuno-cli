import {
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 employers domain — employers, their company
 * memberships, and company claims. Request bodies, paths, and queries are
 * derived from the generated OpenAPI contract. Wire shape:
 * `docs/api/v1/21-candidates-employers.md`.
 *
 * `remove` is the GDPR cascade delete — it returns `202` with an
 * `employers.remove` operation to poll. `approveClaim`/`rejectClaim` are
 * idempotent (a claim already in the requested terminal state returns unchanged;
 * the other terminal state → 409).
 */
export type EmployerListQuery =
  paths['/employers']['get']['parameters']['query'];
export type MembershipListQuery =
  paths['/employers/memberships']['get']['parameters']['query'];
export type ClaimListQuery =
  paths['/employers/claims']['get']['parameters']['query'];

export function createEmployersClient(opts: CavunoClientOptions) {
  const c = createCavunoClient(opts);
  const headers = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: (query?: EmployerListQuery) =>
      c.GET('/employers', { params: { query: query ?? {} } }),
    get: (employerId: string) =>
      c.GET('/employers/{id}', {
        params: { path: { id: employerId } },
      }),
    remove: (employerId: string, idempotency: IdempotencyOptions) =>
      c.DELETE('/employers/{id}', {
        params: { path: { id: employerId } },
        headers: headers(idempotency),
      }),
    listMemberships: (query?: MembershipListQuery) =>
      c.GET('/employers/memberships', {
        params: { query: query ?? {} },
      }),
    getMembership: (membershipId: string) =>
      c.GET('/employers/memberships/{id}', {
        params: { path: { id: membershipId } },
      }),
    listClaims: (query?: ClaimListQuery) =>
      c.GET('/employers/claims', { params: { query: query ?? {} } }),
    approveClaim: (
      claimId: string,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/employers/claims/{id}/approve', {
        params: { path: { id: claimId } },
        headers: headers(idempotency),
      }),
    rejectClaim: (
      claimId: string,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/employers/claims/{id}/reject', {
        params: { path: { id: claimId } },
        headers: headers(idempotency),
      }),
  };
}

export type EmployersClient = ReturnType<typeof createEmployersClient>;
