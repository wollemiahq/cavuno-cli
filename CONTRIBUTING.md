# Contributing

Thank you for helping improve the Cavuno CLI.

## Before opening a change

- Search existing issues and pull requests.
- Open an issue first for significant behavior or interface changes.
- Never commit API keys, access tokens, customer data, non-public information,
  vulnerability details, or generated artifacts from an unreviewed
  specification.

## Development

1. Use a supported Node.js version.
2. Install dependencies with `pnpm install`.
3. Build with `pnpm build`.
4. Run `pnpm test` and `pnpm typecheck`.
5. Inspect the exact publish artifact with `npm pack --dry-run`.

Keep changes focused and add tests for changed behavior. Commands must use the
documented Cavuno API.

By submitting a contribution, you agree that it may be distributed under the
MIT License and that you have the right to submit it.

## Releases

Releases are published from `main` by the repository's `Publish to npm`
workflow. Maintainers update the package version and changelog in a pull
request, merge it after CI passes, and then run the publishing workflow from
`main`.

The workflow uses npm trusted publishing with short-lived GitHub Actions
credentials. Published packages include provenance linking the npm artifact to
the public source commit and workflow that produced it.
