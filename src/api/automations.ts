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

export type CreateAutomationBody = JsonBody<paths['/automations']['post']>;
export type UpdateAutomationBody = JsonBody<
  paths['/automations/{id}']['patch']
>;
export type UpdateAutomationEmailBody = JsonBody<
  paths['/automations/{id}/emails/{stepId}']['put']
>;
export type TestAutomationBody = JsonBody<
  paths['/automations/{id}/test']['post']
>;
export type ListAutomationEnrolmentsQuery = NonNullable<
  paths['/automations/{id}/enrolments']['get']['parameters']['query']
>;

/** Emails that go out when something happens: defaults and your own, draft then Publish. */
export function createAutomationsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const path = (id: string) => ({ params: { path: { id } } });
  const emailPath = (id: string, stepId: string) => ({
    params: { path: { id, stepId } },
  });

  return {
    list: () => c.GET('/automations'),
    get: (id: string) => c.GET('/automations/{id}', path(id)),
    create: (body: CreateAutomationBody) => c.POST('/automations', { body }),
    update: (id: string, body: UpdateAutomationBody) =>
      c.PATCH('/automations/{id}', { ...path(id), body }),
    delete: (id: string) => c.DELETE('/automations/{id}', path(id)),
    duplicate: (id: string) => c.POST('/automations/{id}/duplicate', path(id)),
    getEmail: (id: string, stepId: string) =>
      c.GET('/automations/{id}/emails/{stepId}', emailPath(id, stepId)),
    updateEmail: (
      id: string,
      stepId: string,
      body: UpdateAutomationEmailBody,
    ) =>
      c.PUT('/automations/{id}/emails/{stepId}', {
        ...emailPath(id, stepId),
        body,
      }),
    publish: (id: string) => c.POST('/automations/{id}/publish', path(id)),
    pause: (id: string) => c.POST('/automations/{id}/pause', path(id)),
    stop: (id: string) => c.POST('/automations/{id}/stop', path(id)),
    test: (id: string, body: TestAutomationBody = {}) =>
      c.POST('/automations/{id}/test', { ...path(id), body }),
    enrolments: (id: string, query: ListAutomationEnrolmentsQuery = {}) =>
      c.GET('/automations/{id}/enrolments', {
        params: { path: { id }, query },
      }),
  };
}

export type AutomationsClient = ReturnType<typeof createAutomationsClient>;
