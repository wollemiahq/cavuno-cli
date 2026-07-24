/**
 * Resolve API credentials from the environment. Single source of truth
 * shared by every subcommand. Fails fast with a clear, actionable error
 * if `CAVUNO_API_KEY` is missing or malformed (avoids waiting for a
 * 401 round-trip).
 */

const KEY_PATTERN = /^cavuno_live_[a-z2-7]{16}_[A-Za-z0-9_-]{32}$/;

const DEFAULT_API_URL = 'https://api.cavuno.com/v1';

export interface ResolvedAuth {
  apiKey: string;
  baseUrl: string;
}

export function resolveAuth(opts: { apiUrl?: string } = {}): ResolvedAuth {
  const apiKey = process.env.CAVUNO_API_KEY;
  if (!apiKey) {
    throw new CliError(
      'CAVUNO_API_KEY env var is not set. Mint an API key at ' +
        '/home/<board>/settings/api, then export it before running cavuno.',
      1,
    );
  }
  if (!KEY_PATTERN.test(apiKey)) {
    throw new CliError(
      'CAVUNO_API_KEY is not a valid live API key. Expected format: ' +
        '`cavuno_live_<16-char keyId>_<32-char secret>`.',
      1,
    );
  }
  return {
    apiKey,
    baseUrl: opts.apiUrl ?? process.env.CAVUNO_API_URL ?? DEFAULT_API_URL,
  };
}

/**
 * CLI-friendly error with an explicit exit code. Caught at the
 * commander root and translated to a clean message + process exit.
 */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
