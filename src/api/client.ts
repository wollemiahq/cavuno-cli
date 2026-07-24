import createOpenApiClient from 'openapi-fetch';

import type { paths } from './generated/openapi-types.js';

export interface CavunoClientOptions {
  /**
   * Base URL for the v1 REST API. Examples:
   *   - Production: `https://api.cavuno.com/v1`
   *   - Local dev:  `http://localhost:3000/api/v1`
   *
   * Note the `/v1` suffix — the OpenAPI spec's path entries are relative
   * to this base (e.g. `/jobs`, `/jobs/{id}`).
   */
  baseUrl: string;
  /**
   * API key in the `cavuno_live_<keyId>_<secret>` format. Mint one under
   * Settings → Developer → API keys (`/home/<board>/settings/api`).
   */
  apiKey: string;
  /**
   * Optional account ID. Set automatically as the `X-Cavuno-Account`
   * header on every outgoing request. Only meaningful for
   * `user_session` callers who belong to multiple accounts; for
   * `api_key` and `oauth_token` credentials the account is implicit
   * and the header is ignored on the server.
   */
  accountId?: string;
  /** Optional extra headers to merge into every request. */
  headers?: Record<string, string>;
  /**
   * Optional `fetch` override. Defaults to the global `fetch`. Useful for
   * tests (mock fetch) and for runtime environments where a custom fetch
   * (e.g. Node 18 polyfill, server-side rendering) is required.
   */
  fetch?: typeof fetch;
}

export interface IdempotencyOptions {
  /** Reuse this value when retrying the same logical mutation. */
  idempotencyKey: string;
}

const KEY_PATTERN = /^cavuno_live_[a-z2-7]{16}_[A-Za-z0-9_-]{32}$/;

/**
 * Validate the documented API-key format BEFORE making any HTTP call.
 * Throws synchronously so consumers fail fast with a clear
 * error instead of waiting for a 401 from the network.
 */
function assertApiKeyShape(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      'CAVUNO_API_KEY is not a valid live API key. Expected format: ' +
        '`cavuno_live_<16-char keyId>_<32-char secret>`. Mint one at ' +
        '/home/<board>/settings/api in the dashboard.',
    );
  }
}

/**
 * Create a typed Cavuno API client backed by `openapi-fetch`. Methods
 * follow the OpenAPI path convention (`client.GET('/jobs/{id}', ...)`)
 * with full inference for params, body, and response shape from
 * `./generated/openapi-types.ts`.
 *
 * Per-domain ergonomic facades (`createJobsClient`, future `createCompaniesClient`,
 * etc.) wrap this for the most-common operations.
 */
export function createCavunoClient(opts: CavunoClientOptions) {
  assertApiKeyShape(opts.apiKey);
  return createOpenApiClient<paths>({
    baseUrl: opts.baseUrl,
    headers: {
      ...(opts.headers ?? {}),
      ...(opts.accountId ? { 'X-Cavuno-Account': opts.accountId } : {}),
      // Authentication is trusted configuration, never an overridable
      // convenience header.
      Authorization: `Bearer ${opts.apiKey}`,
    },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

export type CavunoClient = ReturnType<typeof createCavunoClient>;
