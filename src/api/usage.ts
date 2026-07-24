import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

/**
 * Ergonomic facade over the raw `openapi-fetch` client for the usage
 * domain. Returns the `{ data, error, response }` envelope from
 * `openapi-fetch` — consumers branch on `error` first.
 *
 * `GET /usage` returns actionable typed capacities (`used` / `limit` /
 * `remaining`) for active jobs, confirmed subscribers, and team seats.
 * Plan details live on `GET /billing/subscription`.
 */
export function createUsageClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    /** GET /v1/usage — actionable product capacity (used / limit / remaining). */
    get: () => c.GET('/usage', {}),
  };
}

export type UsageClient = ReturnType<typeof createUsageClient>;
