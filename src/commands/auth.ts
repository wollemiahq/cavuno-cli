import { Command } from 'commander';

import { createMeClient } from '../api/me.js';
import { annotate } from '../lib/annotate.js';
import { CliError, resolveBaseUrl } from '../lib/auth.js';
import {
  deleteSession,
  readSession,
  saveSession,
  withCredentialsLock,
} from '../lib/credentials.js';
import { fromApiError } from '../lib/error.js';
import { login, needsRefresh, refresh, revoke } from '../lib/oauth.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

/**
 * Before any API command: renew a stored session whose access token has
 * expired, so `resolveAuth` hands out a live token. An API key in
 * `CAVUNO_API_KEY` takes precedence and needs no renewal.
 */
export async function refreshStoredSession(opts: {
  apiUrl?: string;
}): Promise<void> {
  if (process.env.CAVUNO_API_KEY) return;
  const baseUrl = resolveBaseUrl(opts);
  const session = readSession(baseUrl);
  if (!session || !needsRefresh(session)) return;
  await withCredentialsLock(async () => {
    // Another command may have renewed it while this one waited for the lock.
    const current = readSession(baseUrl);
    if (!current || !needsRefresh(current)) return;
    saveSession(baseUrl, await refresh(current));
  });
}

export function registerAuthCommand(root: Command): void {
  const auth = root
    .command('auth')
    .description(
      'Sign the CLI in to your board with your browser, check who it is signed in as, or sign out.',
    );

  annotate(
    auth
      .command('login')
      .description(
        'Sign in with your browser and choose the board to connect. Saves a session that renews itself; CAVUNO_API_KEY still takes precedence when set.',
      )
      .option(
        '--no-browser',
        'Print the sign-in URL instead of opening a browser',
      )
      .action(async function (this: Command) {
        const opts = this.optsWithGlobals<GlobalOpts & { browser: boolean }>();
        const baseUrl = resolveBaseUrl(opts);
        const session = await login({
          baseUrl,
          ...(opts.browser ? {} : { openUrl: () => {} }),
        });

        const { data, error, response } = await createMeClient({
          apiKey: session.accessToken,
          baseUrl,
        }).get();
        if (error) throw fromApiError(error, response);

        await withCredentialsLock(async () =>
          saveSession(baseUrl, { ...session, board: data.board }),
        );
        print(
          { signedIn: true, board: data.board, apiUrl: baseUrl },
          opts.format ?? 'json',
        );
      }),
    { examples: ['cavuno auth login', 'cavuno auth login --no-browser'] },
  );

  annotate(
    auth
      .command('status')
      .description(
        'Show the board the CLI is signed in to, and how it authenticates.',
      )
      .action(function (this: Command) {
        const opts = this.optsWithGlobals<GlobalOpts>();
        const baseUrl = resolveBaseUrl(opts);
        const session = readSession(baseUrl);
        const via = process.env.CAVUNO_API_KEY
          ? 'api_key'
          : session
            ? 'browser_login'
            : null;
        print(
          {
            signedIn: via !== null,
            via,
            board: session?.board ?? null,
            apiUrl: baseUrl,
          },
          opts.format ?? 'json',
        );
        if (via === null) {
          throw new CliError('Not signed in. Run `cavuno auth login`.', 1);
        }
      }),
    { examples: ['cavuno auth status'] },
  );

  annotate(
    auth
      .command('logout')
      .description(
        'Sign out: revoke the saved session and delete it from this machine.',
      )
      .action(async function (this: Command) {
        const opts = this.optsWithGlobals<GlobalOpts>();
        const baseUrl = resolveBaseUrl(opts);
        await withCredentialsLock(async () => {
          const session = readSession(baseUrl);
          if (!session) return;
          await revoke(session);
          deleteSession(baseUrl);
        });
        print({ signedIn: false, apiUrl: baseUrl }, opts.format ?? 'json');
      }),
    { examples: ['cavuno auth logout'] },
  );
}
