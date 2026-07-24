import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 imports domain — CSV bulk-load batches,
 * their two-step async lifecycle (`imports.parse` → `imports.confirm`), the
 * daily quota. Request bodies, paths, and queries
 * are derived from the generated OpenAPI contract. Wire shape:
 * `docs/api/v1/12-imports.md`.
 *
 * `create` is multipart-only (the server reads `request.formData()`), so — like
 * the media facade — openapi-fetch doesn't help and the caller hands us a
 * `Blob`; the two async initiators (`create`, `confirm`) return `202` with an
 * operation to poll (see the operations client). Mutations forward an
 * `Idempotency-Key` per `04-async-operations.md §9`.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type ImportListQuery = paths['/imports']['get']['parameters']['query'];
export type ConfirmImportBody = JsonBody<
  paths['/imports/{id}/confirm']['post']
>;

export interface ImportUploadOptions {
  /** The CSV file to upload. */
  file: Blob;
  /** Filename recorded on the batch (e.g. `jobs.csv`). */
  fileName: string;
  /** Optional source format. Only `csv` is supported in v1. */
  sourceFormat?: 'csv';
}

export function createImportsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idem = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    list: (query?: ImportListQuery) => c.GET('/imports', { params: { query } }),
    get: (id: string) => c.GET('/imports/{id}', { params: { path: { id } } }),
    /**
     * Upload a CSV and start the async `imports.parse` discovery operation.
     * Multipart-only, so this bypasses openapi-fetch and posts a `FormData`
     * body directly (media-facade pattern).
     */
    create: async (
      options: ImportUploadOptions,
      idempotency: IdempotencyOptions,
    ) => {
      const formData = new FormData();
      formData.set('file', options.file, options.fileName);
      formData.set('sourceFormat', options.sourceFormat ?? 'csv');

      const url = `${opts.baseUrl}/imports`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${opts.apiKey}`,
        'Idempotency-Key': idempotency.idempotencyKey,
      };
      if (opts.accountId) headers['X-Cavuno-Account'] = opts.accountId;

      const doFetch = opts.fetch ?? fetch;
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
    confirm: (
      id: string,
      body: ConfirmImportBody | undefined,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/imports/{id}/confirm', {
        params: { path: { id } },
        body,
        headers: idem(idempotency),
      }),
    cancel: (id: string, idempotency: IdempotencyOptions) =>
      c.POST('/imports/{id}/cancel', {
        params: { path: { id } },
        headers: idem(idempotency),
      }),
    quota: () => c.GET('/imports/quota'),
  };
}

export type ImportsClient = ReturnType<typeof createImportsClient>;
