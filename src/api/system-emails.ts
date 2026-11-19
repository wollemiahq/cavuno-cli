import {
  type CavunoClient,
  type CavunoClientOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

export type PublishSystemEmailBody = JsonBody<
  paths['/system-emails/{type}']['put']
>;

/** The wording of the emails your board sends, and the template each uses. */
export function createSystemEmailsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const path = (type: string) => ({ params: { path: { type } } });

  return {
    list: () => c.GET('/system-emails'),
    get: (type: string) => c.GET('/system-emails/{type}', path(type)),
    publish: (type: string, body: PublishSystemEmailBody) =>
      c.PUT('/system-emails/{type}', { ...path(type), body }),
    reset: (type: string) => c.DELETE('/system-emails/{type}', path(type)),
    setLayout: (type: string, layoutId: string) =>
      c.PUT('/system-emails/{type}/layout', {
        ...path(type),
        body: { layoutId },
      }),
    test: (type: string) => c.POST('/system-emails/{type}/test', path(type)),
  };
}

export type SystemEmailsClient = ReturnType<typeof createSystemEmailsClient>;
