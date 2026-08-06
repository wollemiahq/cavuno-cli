# Changelog

This changelog records changes that affect installation, commands, API
compatibility, or automation behavior.

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
