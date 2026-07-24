import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for employer-subscription reads.
 * Wire shape: `docs/api/v1/22-billing.md` § Employer subscriptions.
 */
export type EmployerSubscriptionListQuery =
  paths['/employer-subscriptions']['get']['parameters']['query'];

export function createEmployerSubscriptionsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    list: (query?: EmployerSubscriptionListQuery) =>
      c.GET('/employer-subscriptions', { params: { query: query ?? {} } }),
    get: (id: string) =>
      c.GET('/employer-subscriptions/{id}', { params: { path: { id } } }),
  };
}

export type EmployerSubscriptionsClient = ReturnType<
  typeof createEmployerSubscriptionsClient
>;
