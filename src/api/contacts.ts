import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

export type ContactListQuery = NonNullable<
  paths['/contacts']['get']['parameters']['query']
>;
export type ContactSubscriptionKind =
  paths['/contacts/{id}/subscriptions/{kind}']['delete']['parameters']['path']['kind'];

/**
 * Facade for `/v1/contacts`: everyone the board can email, one row per
 * person, with their job alerts, job matches and marketing consent. Operators
 * can turn subscriptions off but never add one; `resubscribe` undoes an
 * unsubscribe the team made, or emails the person a confirmation link.
 * `/v1/subscribers` stays the job alert view.
 *
 * Writes send an `Idempotency-Key`: the two DELETEs require one, and the
 * POSTs replay a repeated key instead of acting twice.
 */
export function createContactsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const contact = (id: string) => ({ params: { path: { id } } });
  const headers = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: (query?: ContactListQuery) =>
      c.GET('/contacts', { params: { query: query ?? {} } }),
    get: (id: string) => c.GET('/contacts/{id}', contact(id)),
    emails: (id: string) => c.GET('/contacts/{id}/emails', contact(id)),
    activity: (id: string) => c.GET('/contacts/{id}/activity', contact(id)),
    jobAlerts: (id: string) => c.GET('/contacts/{id}/job-alerts', contact(id)),
    jobAlert: (id: string, alertId: string) =>
      c.GET('/contacts/{id}/job-alerts/{alertId}', {
        params: { path: { id, alertId } },
      }),
    subscription: (id: string, kind: ContactSubscriptionKind) =>
      c.GET('/contacts/{id}/subscriptions/{kind}', {
        params: { path: { id, kind } },
      }),
    unsubscribe: (id: string, idempotency: IdempotencyOptions) =>
      c.POST('/contacts/{id}/unsubscribe', {
        ...contact(id),
        headers: headers(idempotency),
      }),
    resubscribe: (id: string, idempotency: IdempotencyOptions) =>
      c.POST('/contacts/{id}/resubscribe', {
        ...contact(id),
        headers: headers(idempotency),
      }),
    removeSubscription: (
      id: string,
      kind: ContactSubscriptionKind,
      idempotency: IdempotencyOptions,
    ) =>
      c.DELETE('/contacts/{id}/subscriptions/{kind}', {
        params: { path: { id, kind } },
        headers: headers(idempotency),
      }),
    removeJobAlert: (
      id: string,
      alertId: string,
      idempotency: IdempotencyOptions,
    ) =>
      c.DELETE('/contacts/{id}/job-alerts/{alertId}', {
        params: { path: { id, alertId } },
        headers: headers(idempotency),
      }),
  };
}

export type ContactsClient = ReturnType<typeof createContactsClient>;
