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

type PatchSettingsBody = JsonBody<paths['/settings']['patch']>;
type AdsenseConfigBody = JsonBody<paths['/settings/adsense']['put']>;
type PasswordProtectionBody = JsonBody<
  paths['/settings/password-protection']['post']
>;
type JobFormCustomFieldsBody = JsonBody<
  paths['/settings/job-form/custom-fields']['put']
>;
type JobFormCustomFieldAiFillBody = JsonBody<
  paths['/settings/job-form/custom-fields/ai-fill']['post']
>;
type ProfileFieldEntity =
  paths['/settings/profile-fields/{entity}']['put']['parameters']['path']['entity'];
type ProfileFieldDefinitionsBody = JsonBody<
  paths['/settings/profile-fields/{entity}']['put']
>;
type ProfileFieldAiFillEntity =
  paths['/settings/profile-fields/{entity}/ai-fill']['post']['parameters']['path']['entity'];
type ProfileFieldAiFillBody = JsonBody<
  paths['/settings/profile-fields/{entity}/ai-fill']['post']
>;

/**
 * Ergonomic facade over the raw `openapi-fetch` client for the settings
 * domain.  surface — singleton settings + AdSense +
 * hero clear + password protection on/off — plus  typed
 * job-form custom-fields write. Mirrors the jobs facade.
 */
export function createSettingsClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);

  return {
    /** GET /v1/settings — singleton board settings. */
    get: () => c.GET('/settings', {}),

    /** PATCH /v1/settings — partial update. */
    update: (body: PatchSettingsBody) => c.PATCH('/settings', { body }),

    /** GET /v1/settings/adsense — AdSense projection. */
    getAdsense: () => c.GET('/settings/adsense', {}),

    /** PUT /v1/settings/adsense — replace AdSense config. */
    updateAdsense: (body: AdsenseConfigBody) =>
      c.PUT('/settings/adsense', { body }),

    /** DELETE /v1/settings/hero — remove the hero image. */
    deleteHero: () => c.DELETE('/settings/hero', {}),

    /** POST /v1/settings/password-protection — enable + set password. */
    setPasswordProtection: (body: PasswordProtectionBody) =>
      c.POST('/settings/password-protection', { body }),

    /** DELETE /v1/settings/password-protection — disable + clear hash. */
    clearPasswordProtection: () =>
      c.DELETE('/settings/password-protection', {}),

    /**
     * PUT /v1/settings/job-form/custom-fields — whole-array replace of
     * custom field definitions. Returns the full job-form
     * config (same shape as GET /v1/settings/job-form).
     */
    setJobFormCustomFields: (body: JobFormCustomFieldsBody) =>
      c.PUT('/settings/job-form/custom-fields', { body }),

    /**
     * POST /v1/settings/job-form/custom-fields/ai-fill: start a background
     * run that fills the named custom fields on live jobs with AI (202).
     */
    startJobFormCustomFieldAiFill: (body: JobFormCustomFieldAiFillBody) =>
      c.POST('/settings/job-form/custom-fields/ai-fill', { body }),

    /** GET /v1/settings/profile-fields/{entity}: list field definitions. */
    listProfileFieldDefinitions: (entity: ProfileFieldEntity) =>
      c.GET('/settings/profile-fields/{entity}', {
        params: { path: { entity } },
      }),

    /**
     * PUT /v1/settings/profile-fields/{entity}: whole-array replace of
     * candidate or company field definitions. Array order is display order.
     */
    replaceProfileFieldDefinitions: (
      entity: ProfileFieldEntity,
      body: ProfileFieldDefinitionsBody,
    ) =>
      c.PUT('/settings/profile-fields/{entity}', {
        params: { path: { entity } },
        body,
      }),

    /**
     * POST /v1/settings/profile-fields/{entity}/ai-fill: start a background
     * run that fills the named company fields on companies with AI (202).
     */
    startProfileFieldAiFill: (
      entity: ProfileFieldAiFillEntity,
      body: ProfileFieldAiFillBody,
    ) =>
      c.POST('/settings/profile-fields/{entity}/ai-fill', {
        params: { path: { entity } },
        body,
      }),
  };
}

export type SettingsClient = ReturnType<typeof createSettingsClient>;
