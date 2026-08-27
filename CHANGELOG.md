# Changelog

This changelog records changes that affect installation, commands, API
compatibility, or automation behavior.

## 1.8.0 — 2026-08-27

- **`settings update`** accepts `--job-recommendations-enabled` and
  `--recommended-talent-enabled` to toggle candidate job recommendations and
  employer recommended talent.
- **Webhooks**: `candidate.profile.updated` is a recognized event with a
  closed `changed_fields` vocabulary (`profile.headline`, `profile.bio`,
  `profile.location`, `profile.country_code`, `skills`, `languages`,
  `experience`, `education`).
- **Generated API types** cover operator candidate create, update, and
  reconcile routes plus the membership sync results. Candidate skills are
  capped at 200 entries.

## 1.7.0 — 2026-08-23

- **Apply country gating**: board settings now expose
  `countryGatingMode` through `settings get`, and `settings update` accepts
  `--country-gating-mode sponsored_only|all_jobs`. Sponsored-only is the safe
  default when sponsored jobs are enabled; all-jobs also covers ordinary
  external and native Apply flows in compatible starters.

## 1.6.1 — 2026-08-22

- **Company blocklist commands**: `confirmOrAbort` now receives a single
  options object, matching the current prompts helper. Block and unblock
  confirmation prompts work again.

## 1.6.0 — 2026-08-21

- **Company blocklist**: block a company from automated sourcing take-downs so
  imports, backfill, and aggregation cannot reintroduce its jobs; unblock to
  reverse.
- **Analytics**: apply-clicks and job-visitors support grouping by first-touch
  channel, and apply-click rows include `jobSlug`.

## 1.5.1 — 2026-08-07

- **Blog authors**: `location` and `facebookUrl` fields are available on blog
  author create/update/read (same contract as the Board API / dashboard).
  Deleting an author or tag schedules stripping of its ID from posts on the
  board (paginated drain) instead of leaving stale references.

## 1.5.0 — 2026-08-06

- **Integrations surface**: official n8n node, Zapier app, and Make app
  packaging for Cavuno automations (CLI packaging / discovery metadata only
  — commands and API behavior are unchanged).

## 1.4.0 — 2026-08-06

- **Outbound webhooks**: new `webhooks` command group for managing
  webhook subscriptions.
- **Marketing consent**: marketing-permission surfaces rewired
  to user-sourced consent — consent lives on the board user and flows
  through the same /v1 contract the SDK uses.

## 1.3.2 — 2026-08-04

- No user-facing changes. Internal release tooling only (public repository
  lockfiles regenerated for the tsgo provider); commands, installation, and
  automation behavior are unchanged.

## 1.3.1 — 2026-08-03

- No user-facing changes. Internal build tooling only (TypeScript program
  layout and compiler migration); commands, installation, and automation
  behavior are unchanged.

## 1.3.0 — 2026-08-03

- Added read-only Search Console commands for agent-driven reporting and
  diagnostics.

## 1.2.0 — 2026-08-01

- Repaired the audited public-repository export metadata and synchronized the
  generated CLI manifest used by standalone releases.

## 1.1.0 — 2026-07-30

- Renamed the blog image flags to match the media workflow: `--cover-storage-id`
  is now `--cover-media-id` and `--og-image-storage-id` is now
  `--og-image-media-id`. Pass the id returned by
  `cavuno media upload --purpose blog_image`. The previous flags stored an
  identifier the API could not resolve, so scripts using them were not working
  as intended and must be updated.
- Added the `company_not_backfillable` error code (exit code 4), returned when a
  company is registered for backfill but is not backfillable.

## 1.0.4 — 2026-07-24

- Aligned npm, GitHub, README, and command help copy around managing a Cavuno
  job board from the command line.
- Made the private Cavuno source the canonical input to audited public
  repository synchronization and trusted npm publishing.

## 1.0.3 — 2026-07-24

- Added verifiable npm provenance generated from the public Cavuno CLI source
  repository.
- Moved publishing to short-lived GitHub Actions credentials and made
  dependency installation reproducible with a committed lockfile.

## 1.0.2 — 2026-07-24

- Changed the public contact address to `hi@cavuno.com`.
- Simplified repository documentation for external contributors.

## 1.0.1 — 2026-07-24

- Pointed npm and support links to the standalone Cavuno CLI repository.
- Added the public license, trademark notice, security policy, contributing
  guide, and this consumer-facing changelog to the npm package.
- Improved package discovery metadata and linked directly to the
  [Cavuno CLI documentation](https://cavuno.com/docs/cli).

## 1.0.0 — 2026-07-23

- Established the stable public CLI for managing a Cavuno job board.
- Added Backfill rules, company source management, and progress commands.
- Added usage, billing, analytics, paywall, plans, settings, membership,
  invitation, subscriber, reporting, import, and transaction commands.
- Added consistent confirmation prompts and optional polling for asynchronous
  operations.
- Removed provider-specific and service-maintenance commands that are not part
  of the public product API.
