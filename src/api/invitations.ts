import {
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 invitations domain — list, create (returns
 * the accept token + URL), update-role, renew (rotates the token), and revoke.
 * Request bodies, paths, and queries are derived from the generated OpenAPI
 * contract. Wire shape: `docs/api/v1/19-members.md`.
 *
 * Every mutation supports (optional) idempotency; the facade forwards the
 * caller-provided `Idempotency-Key`.
 *
 * Deliberately NOT exposed here: `POST /v1/invitations/:id/accept` is
 * `user_session`-only and `GET /v1/public/invitations/:token` is keyless — an
 * API-key client can call neither, so neither has a facade method.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type InvitationListQuery =
  paths['/invitations']['get']['parameters']['query'];
export type CreateInvitationBody = JsonBody<paths['/invitations']['post']>;
export type InvitationRole = JsonBody<
  paths['/invitations/{id}']['patch']
>['role'];

export function createInvitationsClient(opts: CavunoClientOptions) {
  const c = createCavunoClient(opts);
  const headers = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: (query?: InvitationListQuery) =>
      c.GET('/invitations', { params: { query: query ?? {} } }),
    create: (body: CreateInvitationBody, idempotency: IdempotencyOptions) =>
      c.POST('/invitations', { body, headers: headers(idempotency) }),
    updateRole: (
      id: string,
      role: InvitationRole,
      idempotency: IdempotencyOptions,
    ) =>
      c.PATCH('/invitations/{id}', {
        params: { path: { id } },
        body: { role },
        headers: headers(idempotency),
      }),
    renew: (id: string, idempotency: IdempotencyOptions) =>
      c.POST('/invitations/{id}/renew', {
        params: { path: { id } },
        headers: headers(idempotency),
      }),
    revoke: (id: string, idempotency: IdempotencyOptions) =>
      c.DELETE('/invitations/{id}', {
        params: { path: { id } },
        headers: headers(idempotency),
      }),
  };
}

export type InvitationsClient = ReturnType<typeof createInvitationsClient>;
