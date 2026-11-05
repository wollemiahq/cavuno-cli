import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

/**
 * Ergonomic facade for `GET /v1/todos` — the to-dos on the Board's Home, the
 * same list the dashboard and Companion show.
 */
export function createTodosClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    /** GET /v1/todos — the Board's to-dos, done ones included. */
    list: () => c.GET('/todos', {}),
  };
}

export type TodosClient = ReturnType<typeof createTodosClient>;
