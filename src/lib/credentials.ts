import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * One signed-in board, as `cavuno auth login` left it. Sessions are keyed by
 * API base URL, so a login against a staging or local API never replaces the
 * production one.
 */
export interface StoredSession {
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  resource: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
  board?: { id: string; slug: string; name: string };
}

interface CredentialsFile {
  version: 1;
  sessions: Record<string, StoredSession>;
}

/** `$CAVUNO_CONFIG_DIR`, else `$XDG_CONFIG_HOME/cavuno`, else `~/.config/cavuno`. */
export function configDir(): string {
  if (process.env.CAVUNO_CONFIG_DIR) return process.env.CAVUNO_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'cavuno');
}

function credentialsPath(): string {
  return join(configDir(), 'credentials.json');
}

function readFile(): CredentialsFile {
  let raw: string;
  try {
    raw = readFileSync(credentialsPath(), 'utf8');
  } catch {
    return { version: 1, sessions: {} };
  }
  const parsed = JSON.parse(raw) as Partial<CredentialsFile>;
  return { version: 1, sessions: parsed.sessions ?? {} };
}

function writeFile(file: CredentialsFile): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const path = credentialsPath();
  // Write a sibling file and rename it over, so a reader never sees half a file.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created; tighten a leftover one too.
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** A lock older than this was left by a process that died holding it. */
const STALE_LOCK_MS = 30_000;
const LOCK_TIMEOUT_MS = 60_000;

/**
 * Run `fn` while holding an exclusive lock on the credentials file, across
 * every `cavuno` process on this machine. Refresh tokens are single-use: two
 * processes refreshing the same session at once make the server treat the
 * second as a replay and revoke the whole session, so a refresh must read,
 * renew and save under this lock.
 */
export async function withCredentialsLock<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const lockPath = `${credentialsPath()}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      closeSync(openSync(lockPath, 'wx', 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // Released between our open and stat: try again.
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${lockPath}. Delete it if no other cavuno command is running.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

export function readSession(baseUrl: string): StoredSession | null {
  return readFile().sessions[baseUrl] ?? null;
}

export function saveSession(baseUrl: string, session: StoredSession): void {
  const file = readFile();
  file.sessions[baseUrl] = session;
  writeFile(file);
}

export function deleteSession(baseUrl: string): void {
  const file = readFile();
  delete file.sessions[baseUrl];
  if (Object.keys(file.sessions).length === 0) {
    rmSync(credentialsPath(), { force: true });
    return;
  }
  writeFile(file);
}
