import {
  type CavunoClient,
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

export type CreateTodoBody = JsonBody<paths['/todos']['post']>;
export type UpdateTodoBody = JsonBody<paths['/todos/{id}']['patch']>;
export type CreateTodoCommentBody = JsonBody<
  paths['/todos/{id}/comments']['post']
>;
export type ReorderTodoBody = JsonBody<paths['/todos/{id}/reorder']['post']>;

/**
 * Ergonomic facade for `/v1/todos` — the to-dos on the Board's Home, the same
 * list the dashboard and Companion show: setup and starter to-dos, then the
 * Board's own. Writes take a trailing `IdempotencyOptions` arg, so a retry
 * with the same key does not add or change a to-do twice.
 */
export function createTodosClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idempotencyHeader = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });
  const path = (id: string) => ({ params: { path: { id } } });

  return {
    /**
     * GET /v1/todos — the Board's to-dos, closed ones included; pass the
     * last page's `nextCursor` for more closed ones.
     */
    list: (query: { cursor?: string; limit?: number } = {}) =>
      c.GET('/todos', { params: { query } }),
    get: (id: string) => c.GET('/todos/{id}', path(id)),
    create: (body: CreateTodoBody, idempotency: IdempotencyOptions) =>
      c.POST('/todos', { body, headers: idempotencyHeader(idempotency) }),
    update: (
      id: string,
      body: UpdateTodoBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.PATCH('/todos/{id}', {
        ...path(id),
        body,
        headers: idempotencyHeader(idempotency),
      }),
    reorder: (
      id: string,
      body: ReorderTodoBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/todos/{id}/reorder', {
        ...path(id),
        body,
        headers: idempotencyHeader(idempotency),
      }),
    /** GET /v1/todos/{id}/comments — newest first; pass `cursor` for older. */
    comments: (id: string, query: { cursor?: string; limit?: number } = {}) =>
      c.GET('/todos/{id}/comments', { params: { path: { id }, query } }),
    comment: (
      id: string,
      body: CreateTodoCommentBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/todos/{id}/comments', {
        ...path(id),
        body,
        headers: idempotencyHeader(idempotency),
      }),
    remove: (id: string, idempotency: IdempotencyOptions) =>
      c.DELETE('/todos/{id}', {
        ...path(id),
        headers: idempotencyHeader(idempotency),
      }),
  };
}

export type TodosClient = ReturnType<typeof createTodosClient>;
