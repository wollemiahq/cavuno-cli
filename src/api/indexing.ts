import {
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

type ToggleIndexNowBody = JsonBody<
  paths['/integrations/indexing/toggle-indexnow']['post']
>;

/**
 * Ergonomic facade for the v1 Google Indexing domain — the account's
 * indexing configuration and the IndexNow toggle. Wire shape:
 * `docs/api/v1/23-reporting-integrations.md`.
 *
 * `toggle` (Google Indexing on/off) and `retryProvisioning` are intentionally
 * NOT exposed yet — they wrap external Google Search Console verification / GCP
 * provisioning and ship in a future release once those credentials are available.
 */
export function createIndexingClient(opts: CavunoClientOptions) {
  const c = createCavunoClient(opts);

  return {
    getConfig: () => c.GET('/integrations/indexing'),
    toggleIndexNow: (
      enabled: ToggleIndexNowBody['enabled'],
      { idempotencyKey }: IdempotencyOptions,
    ) =>
      c.POST('/integrations/indexing/toggle-indexnow', {
        body: { enabled },
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
  };
}

export type IndexingClient = ReturnType<typeof createIndexingClient>;
