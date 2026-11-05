import { CliError, DEFAULT_API_URL } from './auth.js';
import { type StoredSession } from './credentials.js';

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/**
 * The CLI's Client ID Metadata Document on the production site. The consent
 * screen shows a client identified this way as verified by cavuno.com. Any
 * other API (staging, local) registers a client dynamically instead, unless
 * `$CAVUNO_OAUTH_CLIENT_ID` names that environment's document.
 */
export const DEFAULT_CLIENT_ID =
  'https://cavuno.com/.well-known/cavuno/cli-client.json';

const CALLBACK_PATH = '/callback';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
/** Refresh an access token this close to expiry rather than risk a 401. */
const REFRESH_MARGIN_MS = 60 * 1000;

interface Endpoints {
  issuer: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface LoginOptions {
  baseUrl: string;
  /** Opens the authorization URL. Defaults to the system browser. */
  openUrl?: (url: string) => void;
  /** Where to tell the user what is happening. Defaults to stderr. */
  log?: (line: string) => void;
  timeoutMs?: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new CliError(`Could not read ${url} (HTTP ${res.status}).`, 11);
  }
  return (await res.json()) as T;
}

/** Find the sign-in endpoints from the API's own metadata (RFC 9728, RFC 8414). */
async function discover(baseUrl: string): Promise<Endpoints> {
  const origin = new URL(baseUrl).origin;
  const resource = await getJson<{
    resource: string;
    authorization_servers: string[];
    authorization_server_metadata?: string;
  }>(`${origin}/.well-known/oauth-protected-resource`);
  const metadataUrl =
    resource.authorization_server_metadata ??
    `${new URL(resource.authorization_servers[0]!).origin}/.well-known/oauth-authorization-server`;
  const server = await getJson<{
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
    revocation_endpoint?: string;
  }>(metadataUrl);
  return {
    issuer: server.issuer,
    resource: resource.resource,
    authorizationEndpoint: server.authorization_endpoint,
    tokenEndpoint: server.token_endpoint,
    registrationEndpoint: server.registration_endpoint,
    revocationEndpoint: server.revocation_endpoint,
  };
}

async function resolveClientId(
  baseUrl: string,
  endpoints: Endpoints,
): Promise<string> {
  if (process.env.CAVUNO_OAUTH_CLIENT_ID) {
    return process.env.CAVUNO_OAUTH_CLIENT_ID;
  }
  if (baseUrl === DEFAULT_API_URL) return DEFAULT_CLIENT_ID;
  if (!endpoints.registrationEndpoint) {
    throw new CliError(
      'This API has no client registration endpoint. Set CAVUNO_OAUTH_CLIENT_ID.',
      1,
    );
  }
  const res = await fetch(endpoints.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Cavuno CLI',
      redirect_uris: [`http://127.0.0.1${CALLBACK_PATH}`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!res.ok) {
    throw new CliError(
      `Could not register the CLI with ${endpoints.registrationEndpoint} (HTTP ${res.status}).`,
      1,
    );
  }
  return ((await res.json()) as { client_id: string }).client_id;
}

async function postToken(
  tokenEndpoint: string,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res
    .json()
    .catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token || !body.refresh_token) {
    const reason = body.error_description ?? body.error ?? `HTTP ${res.status}`;
    throw new CliError(`Sign-in failed: ${reason.replace(/\.$/, '')}.`, 1);
  }
  return body as TokenResponse;
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/** The system browser. Failure is fine: the URL is always printed too. */
function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser available: the printed URL is the fallback.
  }
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Cavuno CLI</title>
<body style="font:15px system-ui;margin:4rem auto;max-width:28rem">
<p>You're signed in to the Cavuno CLI. You can close this tab.</p></body>`;

/**
 * Wait for the browser to come back to the loopback callback with a code.
 * Resolves with the code once `state` (and `iss`, when sent) match.
 */
function waitForCallback(
  server: Server,
  expected: { state: string; issuer: string },
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new CliError(
          'Timed out waiting for the browser sign-in. Run `cavuno auth login` again.',
          1,
        ),
      );
    }, timeoutMs);

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const params = url.searchParams;
      const fail = (message: string) => {
        res.writeHead(400, { 'content-type': 'text/plain' }).end(message);
        clearTimeout(timer);
        reject(new CliError(message, 1));
      };
      if (params.get('state') !== expected.state) {
        return fail('Sign-in failed: the response did not match this login.');
      }
      const iss = params.get('iss');
      if (iss !== null && iss !== expected.issuer) {
        return fail(
          'Sign-in failed: the response came from an unexpected server.',
        );
      }
      const error = params.get('error');
      if (error) {
        return fail(
          error === 'access_denied'
            ? 'Sign-in was cancelled in the browser.'
            : `Sign-in failed: ${params.get('error_description') ?? error}.`,
        );
      }
      const code = params.get('code');
      if (!code)
        return fail('Sign-in failed: no authorization code was returned.');
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(DONE_PAGE);
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/**
 * Sign in through the browser: OAuth 2.1 authorization code with PKCE, with a
 * loopback redirect (RFC 8252). The access token is bound to the API, not the
 * MCP server, so the CLI can call `/v1` directly.
 */
export async function login(options: LoginOptions): Promise<StoredSession> {
  const log =
    options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const endpoints = await discover(options.baseUrl);
  const clientId = await resolveClientId(options.baseUrl, endpoints);

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const { port } = server.address() as { port: number };
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(16));
    const challenge = base64url(createHash('sha256').update(verifier).digest());

    const authorizeUrl = new URL(endpoints.authorizationEndpoint);
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'full_access',
      state,
    }).toString();

    const callback = waitForCallback(
      server,
      { state, issuer: endpoints.issuer },
      options.timeoutMs ?? LOGIN_TIMEOUT_MS,
    );
    log(
      'Opening your browser to sign in to Cavuno. If it does not open, visit:',
    );
    log(authorizeUrl.toString());
    (options.openUrl ?? openInBrowser)(authorizeUrl.toString());

    const code = await callback;
    const tokens = await postToken(endpoints.tokenEndpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
      resource: endpoints.resource,
    });

    return {
      clientId,
      tokenEndpoint: endpoints.tokenEndpoint,
      revocationEndpoint: endpoints.revocationEndpoint,
      resource: endpoints.resource,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

export function needsRefresh(
  session: StoredSession,
  now = Date.now(),
): boolean {
  return session.expiresAt - REFRESH_MARGIN_MS <= now;
}

/** Trade the refresh token for a new pair. Refresh tokens rotate. */
export async function refresh(session: StoredSession): Promise<StoredSession> {
  const tokens = await postToken(session.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    client_id: session.clientId,
    resource: session.resource,
  }).catch((error: unknown) => {
    if (error instanceof CliError) {
      throw new CliError(
        `Your Cavuno sign-in has expired. Run \`cavuno auth login\` again. (${error.message})`,
        1,
      );
    }
    throw error;
  });
  return {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

/** Best effort: the local session is removed whether or not this succeeds. */
export async function revoke(session: StoredSession): Promise<void> {
  if (!session.revocationEndpoint) return;
  await fetch(session.revocationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: session.refreshToken,
      token_type_hint: 'refresh_token',
      client_id: session.clientId,
    }).toString(),
  }).catch(() => undefined);
}
