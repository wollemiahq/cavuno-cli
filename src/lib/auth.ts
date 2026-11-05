import { readSession } from './credentials.js';

/**
 * Resolve API credentials. Single source of truth shared by every
 * subcommand. `CAVUNO_API_KEY` wins when set; otherwise the session saved by
 * `cavuno auth login` for this API is used. Fails fast with a clear,
 * actionable error when neither exists (avoids waiting for a 401
 * round-trip).
 */

const KEY_PATTERN = /^cavuno_live_[a-z2-7]{16}_[A-Za-z0-9_-]{32}$/;

export const DEFAULT_API_URL = 'https://api.cavuno.com/v1';

export interface ResolvedAuth {
  apiKey: string;
  baseUrl: string;
}

/**
 * The API base URL without trailing slashes, so `…/v1/` and `…/v1` name the
 * same API: the same saved session and, for production, the same CLI client.
 */
export function resolveBaseUrl(opts: { apiUrl?: string } = {}): string {
  return (opts.apiUrl ?? process.env.CAVUNO_API_URL ?? DEFAULT_API_URL).replace(
    /\/+$/,
    '',
  );
}

export function resolveAuth(opts: { apiUrl?: string } = {}): ResolvedAuth {
  const baseUrl = resolveBaseUrl(opts);
  const apiKey = process.env.CAVUNO_API_KEY;
  if (apiKey) {
    if (!KEY_PATTERN.test(apiKey)) {
      throw new CliError(
        'CAVUNO_API_KEY is not a valid live API key. Expected format: ' +
          '`cavuno_live_<16-char keyId>_<32-char secret>`.',
        1,
      );
    }
    return { apiKey, baseUrl };
  }

  const session = readSession(baseUrl);
  if (session) return { apiKey: session.accessToken, baseUrl };

  throw new CliError(
    'Not signed in. Run `cavuno auth login` to sign in with your browser, ' +
      'or set the CAVUNO_API_KEY env var to an API key minted at ' +
      '/home/<board>/settings/api.',
    1,
  );
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
