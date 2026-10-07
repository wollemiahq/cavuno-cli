import { CliError } from '../lib/auth.js';
import { builderGitOutput } from './builder-git.js';
import {
  isApprovedBuilderConfigPath,
  isBuilderCredentialPath,
  isSafeBuilderConfig,
} from './builder-source-policy.js';

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  constants,
} from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_RAW_BYTES = 192 * 1024 * 1024;

type SourceFile = {
  path: string;
  contentsBase64: string;
  executable: boolean;
};

export type BuilderManifest = {
  boardId: string;
  draftId: string;
  baseVersionId: string;
  /** Pulled version whose merge is not yet in HEAD; see promotePendingBase. */
  pendingBaseVersionId?: string;
};

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.ssh', '.aws']);

// Generated output is rooted at the checkout; a source directory with the
// same name under src/ or public/ must not be silently dropped.
const EXCLUDED_ROOT_DIRS = new Set([
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  '.output',
  '.vercel',
]);

function assertSafePath(path: string): void {
  const parts = path.split('/');
  if (
    !path ||
    path.length > 1024 ||
    path !== path.normalize('NFC') ||
    path.includes('\\') ||
    path.includes(':') ||
    /[\u0000-\u001f\u007f-\u009f\ufffd\u202a-\u202e\u2066-\u2069]/u.test(
      path,
    ) ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.endsWith(' ') ||
        part.endsWith('.'),
    )
  ) {
    throw new CliError(`Unsafe Builder source path: ${path}`, 2);
  }
}

function readRegularFile(path: string, limit: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile())
      throw new CliError(`Builder source is not a regular file: ${path}`, 2);
    if (stat.size > limit)
      throw new CliError(`Builder source file exceeds size limit: ${path}`, 2);
    const contents = readFileSync(fd);
    if (contents.length > limit)
      throw new CliError(`Builder source file exceeds size limit: ${path}`, 2);
    return contents;
  } finally {
    closeSync(fd);
  }
}

export function readBuilderManifest(directory: string): BuilderManifest {
  const git = join(directory, '.git');
  const gitStat = lstatSync(git, { throwIfNoEntry: false });
  if (!gitStat?.isDirectory() || gitStat.isSymbolicLink()) {
    throw new CliError(
      'Run builder submit from a Builder checkout with a .git directory.',
      2,
    );
  }
  const path = join(git, 'cavuno-builder.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readRegularFile(path, 4096).toString('utf8'));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('Builder checkout manifest is missing or invalid.', 2);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('Builder checkout manifest is invalid.', 2);
  }
  const record = parsed as Record<string, unknown>;
  for (const field of [
    'boardId',
    'draftId',
    'baseVersionId',
    'pendingBaseVersionId',
  ] as const) {
    const value = record[field];
    if (field === 'pendingBaseVersionId' && value === undefined) continue;
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      throw new CliError(`Builder checkout manifest has invalid ${field}.`, 2);
    }
  }
  return record as BuilderManifest;
}

function assertVersionId(versionId: string): void {
  if (
    !versionId ||
    versionId.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(versionId)
  ) {
    throw new CliError('Builder returned an invalid version ID.', 10);
  }
}

/** Replace the local manifest atomically. */
export function writeBuilderManifest(
  directory: string,
  manifest: BuilderManifest,
): void {
  assertVersionId(manifest.baseVersionId);
  if (manifest.pendingBaseVersionId !== undefined)
    assertVersionId(manifest.pendingBaseVersionId);
  const destination = join(directory, '.git', 'cavuno-builder.json');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Advance only after the server confirms the exact source version. */
export function advanceBuilderManifest(
  directory: string,
  previous: BuilderManifest,
  versionId: string,
): void {
  assertVersionId(versionId);
  const current = readBuilderManifest(directory);
  if (
    current.boardId !== previous.boardId ||
    current.draftId !== previous.draftId ||
    current.baseVersionId !== previous.baseVersionId
  ) {
    throw new CliError('Builder checkout manifest changed during submit.', 10);
  }
  writeBuilderManifest(directory, { ...current, baseVersionId: versionId });
}

/**
 * The checkout's source as Git sees it: tracked files plus untracked files
 * that .gitignore does not exclude, so dev-server state (`.wrangler`) and
 * generated output never upload. Tracked files deleted from the working tree
 * are left out, which deletes them in the submission.
 */
function listBuilderSourcePaths(root: string): string[] {
  let listing: string;
  try {
    listing = builderGitOutput(root, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
  } catch (error) {
    throw new CliError(
      `Builder submit needs Git and a Builder checkout repository: ${error instanceof Error ? error.message : 'git ls-files failed'}`,
      2,
    );
  }
  // An unmerged path appears once per stage.
  return [...new Set(listing.split('\0').filter(Boolean))];
}

export function packageBuilderSource(directory: string): {
  format: 'cavuno-builder-source-v1';
  files: SourceFile[];
} {
  const root = resolve(directory);
  const rootStat = lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new CliError('Builder source directory must be a real directory.', 2);
  }
  const realRoot = realpathSync(root);
  const files: SourceFile[] = [];
  let totalBytes = 0;
  for (const path of listBuilderSourcePaths(root)) {
    const segments = path.split('/');
    if (
      segments.some((segment) => EXCLUDED_DIRS.has(segment.toLowerCase())) ||
      EXCLUDED_ROOT_DIRS.has(segments[0]!.toLowerCase()) ||
      (isBuilderCredentialPath(path) && !isApprovedBuilderConfigPath(path))
    ) {
      if (path === '.cavuno')
        throw new CliError(`Unsafe Builder source configuration: ${path}`, 2);
      continue;
    }
    // Git lists an untracked nested repository as `dir/`.
    if (path.endsWith('/'))
      throw new CliError(
        `Builder source contains a nested Git repository: ${path}`,
        2,
      );
    assertSafePath(path);
    const fullPath = join(root, path);
    const stat = lstatSync(fullPath, { throwIfNoEntry: false });
    if (!stat) continue;
    // realpath also catches a symlinked parent directory, which Git still
    // lists tracked files under when the link's own name is ignored.
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      realpathSync(fullPath) !== join(realRoot, path)
    ) {
      throw new CliError(
        `Builder source contains a symbolic link, submodule or special file: ${path}`,
        2,
      );
    }
    if (files.length >= MAX_FILES)
      throw new CliError('Builder source exceeds 10,000 files.', 2);
    if (stat.size > MAX_FILE_BYTES)
      throw new CliError(`Builder source file exceeds 32 MiB: ${path}`, 2);
    const contents = readRegularFile(fullPath, MAX_FILE_BYTES);
    if (
      isApprovedBuilderConfigPath(path) &&
      !isSafeBuilderConfig(path, contents)
    )
      throw new CliError(`Unsafe Builder source configuration: ${path}`, 2);
    totalBytes += contents.length;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new CliError('Builder source exceeds 128 MiB.', 2);
    files.push({
      path,
      contentsBase64: contents.toString('base64'),
      executable: (stat.mode & 0o111) !== 0,
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { format: 'cavuno-builder-source-v1', files };
}

export function buildBuilderSubmission(directory: string): {
  manifest: BuilderManifest;
  files: SourceFile[];
  body: string;
  idempotencyKey: string;
} {
  const manifest = readBuilderManifest(directory);
  const source = packageBuilderSource(directory);
  const body = JSON.stringify({
    baseVersionId: manifest.baseVersionId,
    source,
  });
  if (Buffer.byteLength(body) > MAX_RAW_BYTES)
    throw new CliError('Builder source upload exceeds 192 MiB.', 2);
  const idempotencyKey = createHash('sha256')
    .update(
      JSON.stringify({
        boardId: manifest.boardId,
        draftId: manifest.draftId,
        body,
      }),
    )
    .digest('hex');
  return { manifest, files: source.files, body, idempotencyKey };
}
