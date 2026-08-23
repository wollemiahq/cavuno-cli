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
export type AnalyticsApplyClicksQuery = Query<
  paths['/analytics/apply-clicks']['get']
>;
export type AnalyticsJobVisitorsQuery = Query<
  paths['/analytics/job-visitors']['get']
>;

/**
 * Typed Board analytics (Operator API).
 *
 * Never exposes raw report snapshots, collectors, or provider connection
 * state — only product metrics, traffic tables, and job-grain first-touch
 * lists.
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
    /** GET /v1/analytics/apply-clicks */
    getApplyClicks: (query?: AnalyticsApplyClicksQuery) =>
      c.GET('/analytics/apply-clicks', { params: { query } }),
    /** GET /v1/analytics/job-visitors */
    getJobVisitors: (query?: AnalyticsJobVisitorsQuery) =>
      c.GET('/analytics/job-visitors', { params: { query } }),
  };
}

export type AnalyticsClient = ReturnType<typeof createAnalyticsClient>;
