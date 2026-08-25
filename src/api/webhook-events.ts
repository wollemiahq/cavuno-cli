/**
 * Outbound webhook event payload types for receivers (WHK-02).
 *
 * Prefer generated OpenAPI components when present; fall back to structural
 * types only for fields the generator does not yet express precisely
 * (closed `changed_fields` vocabulary constant).
 *
 * Not a receiver HTTP endpoint — only payload types for integrators using
 * `verifyWebhook` + their own handler.
 */
import type { components } from './generated/openapi-types.js';

type Schemas = components['schemas'];

/** Closed Job `changed_fields` vocabulary for `job.updated` (runtime constant). */
export const JOB_CHANGED_FIELDS = [
  'slug',
  'title',
  'status',
  'company_id',
  'company_name',
  'location',
  'description',
  'url',
  'employment_type',
  'workplace_type',
  'published_at',
  'expires_at',
] as const;

export type JobChangedField = (typeof JOB_CHANGED_FIELDS)[number];

/** Common outbound webhook event envelope. */
export type WebhookEventEnvelope = Schemas['WebhookEventEnvelope'];

/** V1 Job snapshot on job.created / job.updated. */
export type JobWebhookSnapshot = Schemas['WebhookJobSnapshot'];

/** V1 Job delete tombstone. */
export type JobWebhookTombstone = Schemas['WebhookJobTombstone'];

export type JobCreatedWebhookEvent = Schemas['WebhookJobCreatedEvent'];
export type JobUpdatedWebhookEvent = Schemas['WebhookJobUpdatedEvent'];
export type JobDeletedWebhookEvent = Schemas['WebhookJobDeletedEvent'];

export type JobWebhookEvent =
  | JobCreatedWebhookEvent
  | JobUpdatedWebhookEvent
  | JobDeletedWebhookEvent;

/** Closed Company `changed_fields` vocabulary for `company.updated`. */
export const COMPANY_CHANGED_FIELDS = [
  'slug',
  'name',
  'website',
  'logo_url',
  'url',
] as const;
export type CompanyChangedField = (typeof COMPANY_CHANGED_FIELDS)[number];

export type CompanyWebhookSnapshot = Schemas['WebhookCompanySnapshot'];
export type CompanyWebhookTombstone = Schemas['WebhookCompanyTombstone'];
export type CompanyCreatedWebhookEvent = Schemas['WebhookCompanyCreatedEvent'];
export type CompanyUpdatedWebhookEvent = Schemas['WebhookCompanyUpdatedEvent'];
export type CompanyDeletedWebhookEvent = Schemas['WebhookCompanyDeletedEvent'];
export type CompanyWebhookEvent =
  | CompanyCreatedWebhookEvent
  | CompanyUpdatedWebhookEvent
  | CompanyDeletedWebhookEvent;

/** Closed Candidate `changed_fields` vocabulary for `candidate.updated`. */
export const CANDIDATE_CHANGED_FIELDS = [
  'email',
  'display_name',
  'url',
] as const;
export type CandidateChangedField = (typeof CANDIDATE_CHANGED_FIELDS)[number];
export type CandidateWebhookSnapshot = Schemas['WebhookCandidateSnapshot'];
export type CandidateWebhookTombstone = Schemas['WebhookCandidateTombstone'];
export type CandidateCreatedWebhookEvent =
  Schemas['WebhookCandidateCreatedEvent'];
export type CandidateUpdatedWebhookEvent =
  Schemas['WebhookCandidateUpdatedEvent'];
export type CandidateDeletedWebhookEvent =
  Schemas['WebhookCandidateDeletedEvent'];

/** Closed Candidate profile `changed_fields` vocabulary for `candidate.profile.updated`. */
export const CANDIDATE_PROFILE_CHANGED_FIELDS = [
  'profile.headline',
  'profile.bio',
  'profile.location',
  'profile.country_code',
  'skills',
  'languages',
  'experience',
  'education',
] as const;
export type CandidateProfileChangedField =
  (typeof CANDIDATE_PROFILE_CHANGED_FIELDS)[number];
export type CandidateProfileWebhookPointer =
  Schemas['WebhookCandidateProfilePointer'];
export type CandidateProfileUpdatedWebhookEvent =
  Schemas['WebhookCandidateProfileUpdatedEvent'];
export type CandidateWebhookEvent =
  | CandidateCreatedWebhookEvent
  | CandidateUpdatedWebhookEvent
  | CandidateDeletedWebhookEvent
  | CandidateProfileUpdatedWebhookEvent;

/** Closed marketing-permission `changed_fields` vocabulary. */
export const MARKETING_PERMISSION_CHANGED_FIELDS = [
  'status',
  'source',
  'reason',
  'granted_at',
  'withdrawn_at',
] as const;
export type MarketingPermissionChangedField =
  (typeof MARKETING_PERMISSION_CHANGED_FIELDS)[number];
export type MarketingPermissionWebhookSnapshot =
  Schemas['WebhookMarketingPermissionSnapshot'];
export type MarketingPermissionGrantedWebhookEvent =
  Schemas['WebhookMarketingPermissionGrantedEvent'];
export type MarketingPermissionWithdrawnWebhookEvent =
  Schemas['WebhookMarketingPermissionWithdrawnEvent'];
export type MarketingPermissionWebhookEvent =
  | MarketingPermissionGrantedWebhookEvent
  | MarketingPermissionWithdrawnWebhookEvent;

/** The complete, closed V1 receiver union. */
export type V1WebhookEvent =
  | JobWebhookEvent
  | CompanyWebhookEvent
  | CandidateWebhookEvent
  | MarketingPermissionWebhookEvent;
