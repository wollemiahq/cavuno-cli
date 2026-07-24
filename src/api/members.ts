import {
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 members domain — the membership roster,
 * role changes, suspension, and ownership transfer. Request bodies, paths,
 * and queries are derived from the generated OpenAPI contract. Wire shape:
 * `docs/api/v1/19-members.md`.
 *
 * Every mutation supports (optional) idempotency; the facade always forwards
 * the caller-provided `Idempotency-Key` so replays collapse server-side.
 *
 * Deliberately NOT exposed here: `DELETE /v1/members/me` (leave) is
 * `user_session`-only, so it has no API-key facade method.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

type GeneratedMemberListQuery = paths['/members']['get']['parameters']['query'];

/** The generated query models `suspended` as the wire string `'true' | 'false'`;
 *  the facade takes a real boolean and serializes it. */
export type MemberListQuery = Omit<
  NonNullable<GeneratedMemberListQuery>,
  'suspended'
> & {
  suspended?: boolean;
};

export type MemberRole = JsonBody<paths['/members/{userId}']['patch']>['role'];
type TransferOwnershipBody = JsonBody<
  paths['/members/transfer-ownership']['post']
>;

export function createMembersClient(opts: CavunoClientOptions) {
  const c = createCavunoClient(opts);
  const headers = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: (query?: MemberListQuery) => {
      const { suspended, ...rest } = query ?? {};
      return c.GET('/members', {
        params: {
          query: {
            ...rest,
            ...(suspended !== undefined
              ? { suspended: suspended ? 'true' : 'false' }
              : {}),
          },
        },
      });
    },
    get: (userId: string) =>
      c.GET('/members/{userId}', { params: { path: { userId } } }),
    updateRole: (
      userId: string,
      role: MemberRole,
      idempotency: IdempotencyOptions,
    ) =>
      c.PATCH('/members/{userId}', {
        params: { path: { userId } },
        body: { role },
        headers: headers(idempotency),
      }),
    remove: (userId: string, idempotency: IdempotencyOptions) =>
      c.DELETE('/members/{userId}', {
        params: { path: { userId } },
        headers: headers(idempotency),
      }),
    suspend: (userId: string, idempotency: IdempotencyOptions) =>
      c.POST('/members/{userId}/suspend', {
        params: { path: { userId } },
        headers: headers(idempotency),
      }),
    unsuspend: (userId: string, idempotency: IdempotencyOptions) =>
      c.POST('/members/{userId}/unsuspend', {
        params: { path: { userId } },
        headers: headers(idempotency),
      }),
    transferOwnership: (
      newOwnerUserId: TransferOwnershipBody['newOwnerUserId'],
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/members/transfer-ownership', {
        body: { newOwnerUserId },
        headers: headers(idempotency),
      }),
  };
}

export type MembersClient = ReturnType<typeof createMembersClient>;
