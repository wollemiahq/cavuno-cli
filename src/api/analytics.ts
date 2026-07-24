import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

type Query<P> = P extends {
  parameters?: { query?: infer Q };
}
  ? Q
  : never;

export type AnalyticsOverviewQuery = Query<paths['/analytics/overview']['get']>;
export type AnalyticsTrafficQuery = Query<paths['/analytics/traffic']['get']>;

/**
 * Typed Board homepage analytics (Operator API).
 *
 * Never exposes raw report snapshots, collectors, or provider connection
 * state — only product metrics and traffic tables.
 */
export function createAnalyticsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    /** GET /v1/analytics/overview */
    getOverview: (query?: AnalyticsOverviewQuery) =>
      c.GET('/analytics/overview', { params: { query } }),
    /** GET /v1/analytics/traffic */
    getTraffic: (query?: AnalyticsTrafficQuery) =>
      c.GET('/analytics/traffic', { params: { query } }),
  };
}

export type AnalyticsClient = ReturnType<typeof createAnalyticsClient>;
