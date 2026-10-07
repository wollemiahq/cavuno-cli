import { CliError } from '../lib/auth.js';
import { readBuilderManifest, writeBuilderManifest } from './builder-submit.js';

import type { BuilderManifest } from './builder-submit.js';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Commit whose tree is the manifest's base version: the exact tree Cavuno last
 * accepted from or gave to this checkout, and pull's explicit merge base.
 */
export const BASE_REF = 'refs/cavuno/base';
/** A pulled version whose conflicted merge is not committed yet. */
export const PENDING_REF = 'refs/cavuno/pending';

export type BuilderTreeFile = {
  path: string;
  bytes: Buffer;
  executable: boolean;
};

/**
 * Run Git in one Builder checkout. Ignore the caller's global and system
 * settings and stop discovery at the checkout so source from Cavuno never
 * executes a configured Git integration or touches an enclosing repository.
 */
export function builderGit(
  directory: string,
  args: string[],
  input?: Buffer,
): string {
  return builderGitOutput(directory, args, input).trim();
}

/** builderGit without trimming, for NUL-separated listings. */
export function builderGitOutput(
  directory: string,
  args: string[],
  input?: Buffer,
): string {
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_NAMESPACE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG_PARAMETERS',
  ]) {
    delete env[key];
  }
  Object.assign(env, {
    GIT_CEILING_DIRECTORIES: dirname(directory),
    GIT_TEMPLATE_DIR: '/dev/null',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '0',
    GIT_AUTHOR_NAME: 'Cavuno Builder',
    GIT_AUTHOR_EMAIL: 'builder@cavuno.com',
    GIT_COMMITTER_NAME: 'Cavuno Builder',
    GIT_COMMITTER_EMAIL: 'builder@cavuno.com',
  });
  return execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd: directory,
      stdio: 'pipe',
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...(input ? { input } : {}),
    },
  );
}

/**
 * Write an exact tree as one commit on `ref`, without touching the index or
 * working tree. Every file is stored byte for byte, whatever .gitignore or
 * attributes say, the same tree checkout's baseline force-adds.
 */
export function commitBuilderTree(
  directory: string,
  ref: string,
  parent: string,
  files: BuilderTreeFile[],
  message: string,
): string {
  const chunks: Buffer[] = [];
  const data = (bytes: Buffer) =>
    chunks.push(
      Buffer.from(`data ${bytes.length}\n`),
      bytes,
      Buffer.from('\n'),
    );
  chunks.push(
    Buffer.from(
      `commit ${ref}\ncommitter Cavuno Builder <builder@cavuno.com> ${Math.floor(Date.now() / 1000)} +0000\n`,
    ),
  );
  data(Buffer.from(message));
  chunks.push(Buffer.from(`from ${parent}\ndeleteall\n`));
  for (const file of files) {
    const path = `"${file.path.replace(/["\\]/g, (char) => `\\${char}`)}"`;
    chunks.push(
      Buffer.from(
        `M ${file.executable ? '100755' : '100644'} inline ${path}\n`,
      ),
    );
    data(file.bytes);
  }
  builderGit(
    directory,
    ['fast-import', '--quiet', '--force'],
    Buffer.concat(chunks),
  );
  return builderGit(directory, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

/**
 * Merge `pulled` into HEAD with `base` as the explicit merge base. Plain
 * `git merge` would take the base from history, where the submitted tree is
 * never an ancestor of HEAD; the older commit it finds re-applies submitted
 * lines the server has since reverted, or deletes files submit skips. Returns
 * the conflicted paths, empty when the merge was committed. A conflict leaves
 * a normal in-progress merge: `git commit` records it with both parents and
 * `git merge --abort` undoes it.
 */
export function mergePulledVersion(
  directory: string,
  base: string,
  pulled: string,
  message: string,
): string {
  const git = (args: string[]) => builderGit(directory, args);
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (head === base) {
    git(['merge', '--ff-only', pulled]);
    return '';
  }
  git(['update-ref', 'ORIG_HEAD', head]);
  try {
    // Updates the index and working tree; exits nonzero on conflicts.
    git(['merge-recursive', base, '--', 'HEAD', pulled]);
  } catch (error) {
    const conflicts = git(['diff', '--name-only', '--diff-filter=U']);
    if (!conflicts) throw error;
    writeFileSync(join(directory, '.git', 'MERGE_HEAD'), `${pulled}\n`);
    writeFileSync(join(directory, '.git', 'MERGE_MSG'), `${message}\n`);
    return conflicts;
  }
  const merge = git([
    'commit-tree',
    git(['write-tree']),
    '-p',
    head,
    '-p',
    pulled,
    '-m',
    message,
  ]);
  git(['update-ref', '-m', message, 'HEAD', merge, head]);
  return '';
}

/**
 * A conflicted pull leaves its version pending. Once the agent commits the
 * merge, that version becomes the base; until then the base stays put, so an
 * abandoned merge submits against the old base and gets `stale_base`.
 */
export function promotePendingBase(directory: string): BuilderManifest {
  const manifest = readBuilderManifest(directory);
  const { pendingBaseVersionId, ...rest } = manifest;
  if (pendingBaseVersionId === undefined) return manifest;
  if (existsSync(join(directory, '.git', 'MERGE_HEAD')))
    throw new CliError(
      'Finish the pulled merge first: resolve the conflicts and commit.',
      2,
    );
  try {
    builderGit(directory, ['merge-base', '--is-ancestor', PENDING_REF, 'HEAD']);
  } catch {
    return manifest;
  }
  builderGit(directory, ['update-ref', BASE_REF, PENDING_REF]);
  builderGit(directory, ['update-ref', '-d', PENDING_REF]);
  const promoted = { ...rest, baseVersionId: pendingBaseVersionId };
  writeBuilderManifest(directory, promoted);
  return promoted;
}

/** The exact tree the server accepted is the next pull's merge base. */
export function recordSubmittedBase(
  directory: string,
  files: Array<{ path: string; contentsBase64: string; executable: boolean }>,
): void {
  const head = builderGit(directory, [
    'rev-parse',
    '--verify',
    'HEAD^{commit}',
  ]);
  // Pull passes this commit as the merge base explicitly, so its parent only
  // keeps the base history linear; HEAD's tree holds files submit skips.
  const submitted = commitBuilderTree(
    directory,
    BASE_REF,
    builderGit(directory, ['rev-parse', '--verify', `${BASE_REF}^{commit}`]),
    files.map((file) => ({
      path: file.path,
      bytes: Buffer.from(file.contentsBase64, 'base64'),
      executable: file.executable,
    })),
    'Cavuno Builder submission',
  );
  // Prefer the agent's own commit when it is exactly what was submitted.
  if (
    builderGit(directory, ['rev-parse', `${submitted}^{tree}`]) ===
    builderGit(directory, ['rev-parse', 'HEAD^{tree}'])
  )
    builderGit(directory, ['update-ref', BASE_REF, head]);
}
