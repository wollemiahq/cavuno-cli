import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

/**
 * Ergonomic facade for the v1 blog domain (posts, authors, tags). Loosely
 * typed — the OpenAPI types are regenerated post-merge via
 * the public OpenAPI type generator. Wire shape: the spec at
 * `docs/api/v1/17-blog.md`. Blog images reuse the media facade
 * (`createMediaClient`) with `purpose: 'blog_image'`.
 */
type AnyBody = Record<string, unknown> | unknown[];

export type BlogPostListQuery = Record<string, unknown> & {
  cursor?: string;
  limit?: number;
  status?: string;
};

export function createBlogClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const get = (path: string, query?: Record<string, unknown>) =>
    (
      c.GET as unknown as (
        p: string,
        o: { params: { query: Record<string, unknown> } },
      ) => Promise<unknown>
    )(path, { params: { query: query ?? {} } });
  const post = (path: string, body?: AnyBody) =>
    (
      c.POST as unknown as (
        p: string,
        o: { body?: AnyBody },
      ) => Promise<unknown>
    )(path, { body });
  const patch = (path: string, body: AnyBody) =>
    (
      c.PATCH as unknown as (
        p: string,
        o: { body: AnyBody },
      ) => Promise<unknown>
    )(path, { body });
  const del = (path: string) =>
    (
      c.DELETE as unknown as (
        p: string,
        o?: Record<string, unknown>,
      ) => Promise<unknown>
    )(path);

  const enc = encodeURIComponent;

  return {
    // ── Posts ──
    list: (query?: BlogPostListQuery) => get('/blog/posts', query),
    get: (id: string) => get(`/blog/posts/${enc(id)}`),
    create: (body: AnyBody) => post('/blog/posts', body),
    update: (id: string, body: AnyBody) =>
      patch(`/blog/posts/${enc(id)}`, body),
    remove: (id: string) => del(`/blog/posts/${enc(id)}`),
    publish: (id: string) => post(`/blog/posts/${enc(id)}/publish`),
    unpublish: (id: string) => post(`/blog/posts/${enc(id)}/unpublish`),
    toggleFeatured: (id: string) =>
      post(`/blog/posts/${enc(id)}/toggle-featured`),
    search: (body: AnyBody) => post('/blog/posts/search', body),
    batch: (body: AnyBody) => post('/blog/posts/batch', body),
    // ── Authors ──
    authorsList: (query?: { cursor?: string; limit?: number }) =>
      get('/blog/authors', query),
    authorsGet: (id: string) => get(`/blog/authors/${enc(id)}`),
    authorsCreate: (body: AnyBody) => post('/blog/authors', body),
    authorsUpdate: (id: string, body: AnyBody) =>
      patch(`/blog/authors/${enc(id)}`, body),
    authorsDelete: (id: string) => del(`/blog/authors/${enc(id)}`),
    // ── Tags ──
    tagsList: (query?: { cursor?: string; limit?: number }) =>
      get('/blog/tags', query),
    tagsGet: (id: string) => get(`/blog/tags/${enc(id)}`),
    tagsCreate: (body: AnyBody) => post('/blog/tags', body),
    tagsUpdate: (id: string, body: AnyBody) =>
      patch(`/blog/tags/${enc(id)}`, body),
    tagsDelete: (id: string) => del(`/blog/tags/${enc(id)}`),
  };
}

export type BlogClient = ReturnType<typeof createBlogClient>;
