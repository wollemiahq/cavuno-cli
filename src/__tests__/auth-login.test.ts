import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshStoredSession } from '../commands/auth.js';
import { resolveAuth, resolveBaseUrl } from '../lib/auth.js';
import { readSession, saveSession } from '../lib/credentials.js';
import { login } from '../lib/oauth.js';
import { createCliProgram } from '../program.js';

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BOARD = { id: 'acc_1', slug: 'acme-jobs', name: 'Acme Jobs' };
const jwt = (n: number) => `header.payload${n}.signature`;

/** A minimal OAuth 2.1 authorization server plus `/v1/me`, on loopback. */
function fakeCavuno() {
  const calls = { token: [] as URLSearchParams[], authHeaders: [] as string[] };
  const state = { challenge: '', issued: 0, wrongState: false };
  let origin = '';

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    const json = (status: number, body: unknown) =>
      res
        .writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify(body));
    let raw = '';
    for await (const chunk of req) raw += chunk;

    switch (url.pathname) {
      case '/.well-known/oauth-protected-resource':
        return json(200, {
          resource: `${origin}/api-audience`,
          authorization_servers: [`${origin}/oauth`],
          authorization_server_metadata: `${origin}/.well-known/oauth-authorization-server`,
        });
      case '/.well-known/oauth-authorization-server':
        return json(200, {
          issuer: `${origin}/oauth`,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          registration_endpoint: `${origin}/oauth/register`,
          revocation_endpoint: `${origin}/oauth/revoke`,
        });
      case '/oauth/register':
        return json(201, { client_id: 'dcr_client' });
      case '/oauth/authorize': {
        // Stands in for the user approving consent in the browser.
        state.challenge = url.searchParams.get('code_challenge') ?? '';
        const back = new URL(url.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'auth_code');
        back.searchParams.set(
          'state',
          state.wrongState ? 'forged' : url.searchParams.get('state')!,
        );
        back.searchParams.set('iss', `${origin}/oauth`);
        await fetch(back);
        return res.writeHead(204).end();
      }
      case '/oauth/token': {
        const body = new URLSearchParams(raw);
        calls.token.push(body);
        if (body.get('grant_type') === 'authorization_code') {
          const expected = createHash('sha256')
            .update(body.get('code_verifier') ?? '')
            .digest('base64url');
          if (
            expected !== state.challenge ||
            body.get('code') !== 'auth_code'
          ) {
            return json(400, { error: 'invalid_grant' });
          }
        } else if (body.get('refresh_token') !== `refresh_${state.issued}`) {
          return json(400, { error: 'invalid_grant' });
        }
        state.issued += 1;
        return json(200, {
          access_token: jwt(state.issued),
          refresh_token: `refresh_${state.issued}`,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      case '/v1/me':
        calls.authHeaders.push(req.headers.authorization ?? '');
        return json(200, { object: 'operator', board: BOARD, actor: {} });
      default:
        return res.writeHead(404).end();
    }
  });

  return {
    calls,
    state,
    get baseUrl() {
      return `${origin}/v1`;
    },
    async start() {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    },
    stop: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  };
}

// Stands in for the browser; the fake server is torn down while this may still be open.
const openUrl = (url: string) => void fetch(url).catch(() => {});

describe('cavuno auth login', () => {
  let api: ReturnType<typeof fakeCavuno>;
  let dir: string;
  const env = { ...process.env };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cavuno-cli-'));
    process.env.CAVUNO_CONFIG_DIR = dir;
    delete process.env.CAVUNO_API_KEY;
    delete process.env.CAVUNO_OAUTH_CLIENT_ID;
    api = fakeCavuno();
    await api.start();
  });

  afterEach(async () => {
    process.env = { ...env };
    await api.stop();
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('completes PKCE sign-in and asks for a token bound to the API, not the MCP server', async () => {
    const session = await login({
      baseUrl: api.baseUrl,
      openUrl,
      log: () => {},
    });

    const exchange = api.calls.token[0]!;
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('client_id')).toBe('dcr_client');
    expect(exchange.get('resource')).toMatch(/\/api-audience$/);
    expect(exchange.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );
    expect(session.accessToken).toBe(jwt(1));
    expect(session.refreshToken).toBe('refresh_1');
  });

  it('rejects a callback whose state does not match this login', async () => {
    api.state.wrongState = true;
    await expect(
      login({ baseUrl: api.baseUrl, openUrl, log: () => {} }),
    ).rejects.toThrow(/did not match/);
    expect(api.calls.token).toHaveLength(0);
  });

  it('renews an expired session before an API command and keeps the rotated refresh token', async () => {
    const session = await login({
      baseUrl: api.baseUrl,
      openUrl,
      log: () => {},
    });
    saveSession(api.baseUrl, { ...session, expiresAt: Date.now() - 1 });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await createCliProgram('0.0.0').parseAsync(
      ['me', 'get', '--api-url', api.baseUrl],
      { from: 'user' },
    );

    expect(api.calls.authHeaders).toEqual([`Bearer ${jwt(2)}`]);
    const stored = readSession(api.baseUrl)!;
    expect(stored.refreshToken).toBe('refresh_2');
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
    expect(statSync(join(dir, 'credentials.json')).mode & 0o777).toBe(0o600);
  });

  it('refreshes once when two commands find the session expired at the same time', async () => {
    const session = await login({
      baseUrl: api.baseUrl,
      openUrl,
      log: () => {},
    });
    saveSession(api.baseUrl, { ...session, expiresAt: Date.now() - 1 });

    // Refresh tokens are single-use: a second refresh with the same token would
    // be a replay, which the server answers by revoking the whole session.
    await Promise.all([
      refreshStoredSession({ apiUrl: api.baseUrl }),
      refreshStoredSession({ apiUrl: api.baseUrl }),
    ]);

    const refreshes = api.calls.token.filter(
      (body) => body.get('grant_type') === 'refresh_token',
    );
    expect(refreshes).toHaveLength(1);
    expect(readSession(api.baseUrl)!.refreshToken).toBe('refresh_2');
  });

  it('treats an API URL with a trailing slash as the same API', () => {
    expect(resolveBaseUrl({ apiUrl: 'https://api.cavuno.com/v1/' })).toBe(
      'https://api.cavuno.com/v1',
    );
  });

  it('prefers CAVUNO_API_KEY over a stored session', async () => {
    const session = await login({
      baseUrl: api.baseUrl,
      openUrl,
      log: () => {},
    });
    saveSession(api.baseUrl, session);
    const key = `cavuno_live_${'a'.repeat(16)}_${'B'.repeat(32)}`;
    process.env.CAVUNO_API_KEY = key;

    expect(resolveAuth({ apiUrl: api.baseUrl }).apiKey).toBe(key);
    delete process.env.CAVUNO_API_KEY;
    expect(resolveAuth({ apiUrl: api.baseUrl }).apiKey).toBe(jwt(1));
  });
});
