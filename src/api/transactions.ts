import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for transactions ledger reads.
 * Wire shape: `docs/api/v1/29-exports-analytics.md` §1.
 */
export type TransactionListQuery =
  paths['/transactions']['get']['parameters']['query'];

export function createTransactionsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    list: (query?: TransactionListQuery) =>
      c.GET('/transactions', { params: { query: query ?? {} } }),
    get: (id: string) =>
      c.GET('/transactions/{id}', { params: { path: { id } } }),
  };
}

export type TransactionsClient = ReturnType<typeof createTransactionsClient>;
