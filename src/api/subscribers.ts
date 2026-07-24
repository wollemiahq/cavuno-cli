import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 subscribers domain — the tenant-admin view
 * of alert subscribers. Paths, queries, and bodies are derived from the
 * generated OpenAPI contract. Wire shape: `docs/api/v1/20-alerts.md`.
 *
 * Two endpoints break out of the plain openapi-fetch flow:
 * - `export` returns EITHER an inline `list` (`format=json`, capped at 10,000
 *   rows — a `413 subscribers_export_too_large` past the cap) OR a `202`
 *   `subscribers.export` operation (`format=csv`, default) whose terminal
 *   result carries a `downloadUrl`. Poll it via the operations client.
 * - `import` is a `multipart/form-data` CSV upload (field `file`) that returns
 *   `202` with a `subscribers.import` operation. openapi-fetch does not help
 *   with multipart, so it is issued with a hand-built `fetch` (mirrors the
 *   media facade) while still honouring the injected `fetch` for tests.
 *
 * `import`, `unsubscribe`, and `resubscribe` accept an idempotency key (the
 * routes support it optionally); it is forwarded as the `Idempotency-Key`
 * header.
 */
export type SubscriberListQuery =
  paths['/subscribers']['get']['parameters']['query'];
export type SubscriberExportQuery =
  paths['/subscribers/export']['get']['parameters']['query'];
type SubscriberImportForm =
  paths['/subscribers/import']['post']['requestBody']['content']['multipart/form-data'];

export interface SubscriberImportOptions {
  /** The CSV file to upload (header row with an `email` column). */
  file: Blob;
  /** Filename recorded on the operation (e.g. `subscribers.csv`). */
  fileName: string;
  /**
   * Whether to send a double-opt-in confirmation email to imported
   * unconfirmed subscribers. Defaults to `true` on the server when omitted.
   */
  sendConfirmation?: SubscriberImportForm['sendConfirmation'];
}

export function createSubscribersClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const doFetch = opts.fetch ?? fetch;
  const idempotencyHeader = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: (query?: SubscriberListQuery) =>
      c.GET('/subscribers', { params: { query: query ?? {} } }),
    count: () => c.GET('/subscribers/count'),
    get: (id: string) =>
      c.GET('/subscribers/{id}', { params: { path: { id } } }),
    alerts: (id: string) =>
      c.GET('/subscribers/{id}/alerts', { params: { path: { id } } }),
    export: (query?: SubscriberExportQuery) =>
      c.GET('/subscribers/export', { params: { query: query ?? {} } }),
    unsubscribe: (id: string, idempotency: IdempotencyOptions) =>
      c.POST('/subscribers/{id}/unsubscribe', {
        params: { path: { id } },
        headers: idempotencyHeader(idempotency),
      }),
    resubscribe: (id: string, idempotency: IdempotencyOptions) =>
      c.POST('/subscribers/{id}/resubscribe', {
        params: { path: { id } },
        headers: idempotencyHeader(idempotency),
      }),
    import: async (
      options: SubscriberImportOptions,
      { idempotencyKey }: IdempotencyOptions,
    ) => {
      const formData = new FormData();
      formData.set('file', options.file, options.fileName);
      if (options.sendConfirmation !== undefined) {
        formData.set('sendConfirmation', String(options.sendConfirmation));
      }

      const url = `${opts.baseUrl}/subscribers/import`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${opts.apiKey}`,
        'Idempotency-Key': idempotencyKey,
      };
      if (opts.accountId) headers['X-Cavuno-Account'] = opts.accountId;

      const response = await doFetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = response.ok ? await response.json() : null;
      // A non-JSON error body (e.g. a proxy's HTML 413/502 page) must still
      // surface as an error — `{}` makes `fromApiError` fall back to
      // `http_<status>` instead of the caller treating the failure as success.
      const error = response.ok
        ? null
        : await response.json().catch(() => ({}));
      return { data, error, response };
    },
  };
}

export type SubscribersClient = ReturnType<typeof createSubscribersClient>;
