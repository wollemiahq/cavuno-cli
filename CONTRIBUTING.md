# Contributing

Thank you for helping improve the Cavuno CLI.

## Before opening a change

- Search existing issues and pull requests.
- Open an issue first for significant behavior or interface changes.
- Never commit API keys, access tokens, customer data, private API contracts,
  internal infrastructure details, or generated artifacts from an unfiltered
  service specification.

## Development

1. Use a supported Node.js version.
2. Install dependencies with `pnpm install`.
3. Build with `pnpm build`.
4. Run `pnpm test` and `pnpm typecheck`.
5. Inspect the exact publish artifact with `npm pack --dry-run`.

Keep changes focused and add tests for changed behavior. Public commands must
use the documented Cavuno API rather than private service endpoints.

By submitting a contribution, you agree that it may be distributed under the
MIT License and that you have the right to submit it.
