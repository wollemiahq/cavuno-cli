# Changelog

This changelog records changes that affect installation, commands, API
compatibility, or automation behavior.

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
