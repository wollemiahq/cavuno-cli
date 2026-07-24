import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

/**
 * Ergonomic facade for the v1 media domain. Mirrors the companies facade
 * shape. Wire shape: `docs/api/v1/26-media.md`.
 *
 * `upload` is multipart-only — the openapi-fetch client doesn't help, so
 * the caller hands us a fully-formed `FormData` instance. `get` is plain
 * JSON.
 */
export type MediaPurpose =
  | 'board_logo'
  | 'board_hero'
  | 'account_avatar'
  | 'company_logo'
  | 'blog_image';

export interface MediaUploadOptions {
  file: Blob;
  purpose: MediaPurpose;
  resourceId?: string;
}

export function createMediaClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  const get = (path: string, query?: Record<string, unknown>) =>
    (
      c.GET as unknown as (
        p: string,
        o: { params: { query: Record<string, unknown> } },
      ) => Promise<unknown>
    )(path, { params: { query: query ?? {} } });

  return {
    /**
     * Upload a file via the unified `POST /v1/media/upload` dispatcher.
     * The caller picks the purpose (and optional resourceId for binding
     * uploads); the server enforces per-purpose validation.
     */
    upload: async (options: MediaUploadOptions) => {
      const formData = new FormData();
      formData.set('file', options.file);
      formData.set('purpose', options.purpose);
      if (options.resourceId) formData.set('resourceId', options.resourceId);

      const url = `${opts.baseUrl ?? ''}/media/upload`;

      const headers: Record<string, string> = {};
      if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;
      if (opts.accountId) headers['X-Cavuno-Account'] = opts.accountId;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = response.ok ? await response.json() : null;
      const error = response.ok
        ? null
        : await response.json().catch(() => null);
      return { data, error, response };
    },
    get: (id: string) => get(`/media/${encodeURIComponent(id)}`),
  };
}

export type MediaClient = ReturnType<typeof createMediaClient>;
