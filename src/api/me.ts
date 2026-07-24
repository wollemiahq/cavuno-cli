import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

/**
 * Ergonomic facade for `GET /v1/me` — the Operator identity resource
 * Returns Board binding, actor type, live role, effective
 * permissions, and delegated credential scopes.
 */
export function createMeClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    /** GET /v1/me — current operator identity. */
    get: () => c.GET('/me', {}),
  };
}

export type MeClient = ReturnType<typeof createMeClient>;
