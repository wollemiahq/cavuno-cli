import {
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 reporting domain — reporting integrations
 * (Search Console, AdSense, Tinybird, Stripe). Request bodies, paths, and
 * queries are derived from the
 * generated OpenAPI contract. Wire shape:
 * `docs/api/v1/23-reporting-integrations.md`.
 *
 * `connect` returns an OAuth authorization URL (OAuth providers), an immediate
 * connection (Tinybird), or a Monetization-settings redirect (Stripe). OAuth
 * secrets are always redacted in reads.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type ReportingProvider =
  paths['/integrations/reporting/{provider}']['get']['parameters']['path']['provider'];
type PatchIntegrationBody = JsonBody<
  paths['/integrations/reporting/{provider}']['patch']
>;

export function createReportingClient(opts: CavunoClientOptions) {
  const c = createCavunoClient(opts);
  const headers = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    listIntegrations: () => c.GET('/integrations/reporting'),
    getIntegration: (provider: ReportingProvider) =>
      c.GET('/integrations/reporting/{provider}', {
        params: { path: { provider } },
      }),
    connect: (provider: ReportingProvider, idempotency: IdempotencyOptions) =>
      c.POST('/integrations/reporting/{provider}/connect', {
        params: { path: { provider } },
        headers: headers(idempotency),
      }),
    setEnabled: (
      provider: ReportingProvider,
      enabled: PatchIntegrationBody['enabled'],
      idempotency: IdempotencyOptions,
    ) =>
      c.PATCH('/integrations/reporting/{provider}', {
        params: { path: { provider } },
        body: { enabled },
        headers: headers(idempotency),
      }),
    disconnect: (
      provider: ReportingProvider,
      idempotency: IdempotencyOptions,
    ) =>
      c.DELETE('/integrations/reporting/{provider}', {
        params: { path: { provider } },
        headers: headers(idempotency),
      }),
  };
}

export type ReportingClient = ReturnType<typeof createReportingClient>;
