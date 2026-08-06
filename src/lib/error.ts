/**
 * Map the v1 REST error envelope to a friendly `CliError` with a stable
 * exit code per error code. Used by every subcommand:
 *
 *   if (error) throw fromApiError(error, response);
 *
 * The pretty-printing of code/message/issues/retry-after/requestId is
 * delegated to the local standalone public-client formatter so every command
 * renders the same API error envelope.
 */
import { formatApiError } from '../api/index.js';
import { CliError } from './auth.js';

interface ErrorEnvelope {
  error?: { code?: string };
}

/**
 * Exit-code table layered platform → domain.
 *
 * Platform-level codes (always in this table): auth_*, validation_*,
 * rate_limited, internal_error.
 *
 * Domain-level codes appended as the API expands per the documented convention:
 *   *_not_found           → 4
 *   *_quota_*             → 5
 *   *_plan_cannot_*       → 5
 *   *_already_*           → 7
 *   *_not_*               → 7
 *   *_conflict_*          → 7
 *
 * + adds its codes here following the same pattern. Anything
 * not in the table falls through to exit 10 (treated as internal_error).
 */
const EXIT_CODE_BY_REASON: Record<string, number> = {
  auth_unauthenticated: 1,
  auth_forbidden: 3,
  validation_bad_request: 2,
  settings_conflicting_fields: 2,
  settings_custom_field_type_immutable: 2,
  jobs_not_found: 4,
  jobs_company_not_found: 4,
  jobs_quota_exceeded: 5,
  jobs_plan_cannot_publish: 5,
  jobs_already_published: 7,
  jobs_already_archived: 7,
  jobs_not_published: 7,
  // companies
  companies_not_found: 4,
  companies_no_logo: 4,
  companies_duplicate_domain: 7,
  companies_duplicate_name: 7,
  companies_has_jobs: 7,
  blog_post_not_found: 4,
  blog_author_not_found: 4,
  blog_tag_not_found: 4,
  blog_already_published: 7,
  blog_not_published: 7,
  blog_invalid_transition: 2,
  blog_invalid_author_id: 2,
  blog_invalid_tag_id: 2,
  blog_post_slug_taken: 7,
  blog_author_slug_taken: 7,
  blog_tag_slug_taken: 7,
  media_payload_too_large: 2,
  media_unsupported_type: 2,
  domains_invalid_hostname: 2,
  domains_reserved_hostname: 3,
  domains_not_found: 4,
  domains_hostname_taken: 7,
  //
  operations_not_found: 4,
  operations_already_terminal: 7,
  operations_not_cancellable: 7,
  //
  audit_not_found: 4,
  // taxonomy writes
  taxonomy_skill_not_found: 4,
  taxonomy_category_not_found: 4,
  taxonomy_market_not_found: 4,
  taxonomy_not_found: 4,
  taxonomy_alias_not_found: 4,
  taxonomy_parent_not_found: 4,
  taxonomy_slug_taken: 7,
  taxonomy_alias_taken: 7,
  taxonomy_parent_cycle: 2,
  taxonomy_tree_too_large: 2,
  // imports
  imports_not_found: 4,
  imports_mapping_not_found: 4,
  imports_daily_limit_exceeded: 5,
  imports_already_confirmed: 7,
  imports_already_terminal: 7,
  imports_no_mapping: 2,
  imports_unsupported_format: 2,
  imports_unsupported_type: 2,
  imports_payload_too_large: 2,
  // sourcing
  sourcing_not_configured: 4,
  sourcing_exclusion_not_found: 4,
  backfill_rule_not_found: 4,
  backfill_not_configured: 4,
  backfill_invalid_rule: 4,
  backfill_invalid_filter: 4,
  backfill_upstream_error: 4,
  backfill_company_not_found: 4,
  backfill_candidate_conflict: 4,
  backfill_company_not_startable: 4,
  backfill_company_not_stoppable: 4,
  company_not_backfillable: 4,
  // members / invitations / roles / permissions
  members_not_found: 4,
  members_cannot_change_primary_owner: 7,
  members_cannot_remove_owner: 7,
  members_owner_cannot_leave: 7,
  members_cannot_suspend_owner: 7,
  members_cannot_transfer_to_suspended: 7,
  members_seat_limit_exceeded: 7,
  members_already_member: 7,
  members_forbidden_promotion: 3,
  invitations_not_found: 4,
  invitations_not_pending: 7,
  invitations_expired: 7,
  invitations_email_mismatch: 3,
  notification_prefs_no_member_identity: 3,
  // subscribers
  subscribers_not_found: 4,
  subscribers_already_unsubscribed: 7,
  subscribers_not_unsubscribed: 7,
  subscribers_confirmation_required: 7,
  subscribers_export_too_large: 2,
  subscribers_import_unsupported_format: 2,
  subscribers_import_payload_too_large: 2,
  subscribers_import_too_many_rows: 2,
  // P?? — redirects
  redirects_not_found: 4,
  redirects_from_path_taken: 7,
  redirects_invalid_status_code: 2,
  // WHK — webhooks
  webhooks_not_found: 4,
  webhooks_delivery_open: 7,
  webhooks_delivery_unreplayable: 7,
  webhooks_invalid_url: 2,
  webhooks_invalid_event_types: 2,
  // Create-time capacity cap — same exit family as other webhook BAD_REQUEST
  // validation codes (invalid_url / invalid_event_types → 2).
  webhooks_endpoint_limit: 2,
  // MKT — marketing consent (operator withdraw / list)
  marketing_permissions_not_found: 4,
  rate_limited: 6,
  too_many_filter_values: 2,
  internal_error: 10,
};

export function fromApiError(
  envelope: unknown,
  response: { status: number; headers: Headers },
): CliError {
  const env = envelope as ErrorEnvelope | undefined;
  const code = env?.error?.code ?? `http_${response.status}`;
  const exit = EXIT_CODE_BY_REASON[code] ?? 10;
  return new CliError(formatApiError(envelope, response), exit);
}
