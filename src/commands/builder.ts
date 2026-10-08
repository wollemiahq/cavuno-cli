import { Command } from 'commander';

import { annotate } from '../lib/annotate.js';
import { CliError, resolveAuth } from '../lib/auth.js';
import { print } from '../lib/output.js';
import {
  BASE_REF,
  PENDING_REF,
  builderGit,
  commitBuilderTree,
  mergePulledVersion,
  promotePendingBase,
  recordSubmittedBase,
} from './builder-git.js';
import {
  isApprovedBuilderConfigPath,
  isBuilderCredentialPath,
  isSafeBuilderConfig,
} from './builder-source-policy.js';
import {
  advanceBuilderManifest,
  buildBuilderSubmission,
  readBuilderManifest,
  writeBuilderManifest,
} from './builder-submit.js';

import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_BYTES = 128 * 1024 * 1024;
const STALE_BASE_NEXT_STEP =
  '. Run `npx cavuno@latest builder pull`, resolve any conflicts and commit, then submit again.';
const DOCS_URL = 'https://cavuno.com/docs/ai-website-builder/coding-agents';

type SnapshotFile = {
  path: string;
  contentsBase64: string;
  executable: boolean;
};
type Snapshot = {
  object: 'builder_source_snapshot';
  boardId: string;
  draftId: string;
  baseVersionId: string;
  files: SnapshotFile[];
};

/**
 * Builder commands use the standard Operator API key (`CAVUNO_API_KEY`). The
 * API checks that it belongs to the board and holds `builder.read`,
 * `builder.manage` or `builder.publish` for the command.
 */
function builderApiKey(): string {
  if (!process.env.CAVUNO_API_KEY && process.env.CAVUNO_BUILDER_KEY) {
    throw new CliError(
      'Builder keys are retired; create an API key with a Builder permission ' +
        '(builder.read / builder.manage / builder.publish) and set CAVUNO_API_KEY.',
      1,
    );
  }
  return resolveAuth().apiKey;
}

function builderVersionUrl(
  command: Command,
  directory: string,
): {
  url: string;
  key: string;
  format: 'json' | 'table';
} {
  const manifest = readBuilderManifest(resolve(directory));
  const key = builderApiKey();
  const global = command.optsWithGlobals<{
    apiUrl?: string;
    format?: 'json' | 'table';
  }>();
  const baseUrl = (
    global.apiUrl ??
    process.env.CAVUNO_API_URL ??
    'https://api.cavuno.com/v1'
  ).replace(/\/+$/, '');
  const url = `${baseUrl}/builder/boards/${encodeURIComponent(manifest.boardId)}/drafts/${encodeURIComponent(manifest.draftId)}/versions/${encodeURIComponent(manifest.baseVersionId)}`;
  return { url, key, format: global.format ?? 'json' };
}

/** A gateway answer while Cavuno deploys or restarts; asking again is safe. */
class GatewayUnavailableError extends CliError {}

async function fetchVersion(
  url: string,
  key: string,
  action: 'status' | 'preview' | 'publish',
): Promise<unknown> {
  const response = await fetch(`${url}/${action}`, {
    method: action === 'publish' ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}` },
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = `Builder ${action} failed (${response.status}): ${apiErrorMessage(data) ?? response.statusText}`;
    const exitCode = exitCodeFor(response.status);
    throw [502, 503, 504].includes(response.status)
      ? new GatewayUnavailableError(message, exitCode)
      : new CliError(message, exitCode);
  }
  return data;
}

type VersionStatus = {
  candidate?: { state?: string; failedSummary?: string | null };
  publicExposure?: {
    state?: string;
    reason?: string;
    checks?: Record<string, string> | null;
  } | null;
};

/**
 * Where a submitted version's checks stand: `ready` once the candidate is
 * verified and cleared for public exposure, a one-line reason once it failed,
 * was flagged or revoked, and null while checks are still running.
 */
function builderStatusOutcome(
  value: unknown,
): { ready: true } | { ready: false; reason: string } | null {
  const status = (value ?? {}) as VersionStatus;
  const candidate = status.candidate?.state;
  const exposure = status.publicExposure;
  if (candidate === 'failed')
    return {
      ready: false,
      reason: `Candidate checks failed: ${status.candidate?.failedSummary ?? 'no summary'}`,
    };
  // Staff can clear a flagged version; the flag stays in its evidence.
  if (candidate === 'verified' && exposure?.state === 'cleared')
    return { ready: true };
  const flagged = Object.entries(exposure?.checks ?? {})
    .filter(([, result]) => result === 'flagged')
    .map(([name]) => name);
  // `held` with only `unknown` checks may still be collecting results.
  if (
    exposure?.state === 'revoked' ||
    (exposure?.state !== 'cleared' && flagged.length)
  )
    return {
      ready: false,
      reason: `Version ${exposure?.state === 'revoked' ? 'revoked' : `flagged by ${flagged.join(', ')}`}: ${exposure?.reason ?? 'no reason given'}`,
    };
  return null;
}

async function waitForVersion(
  command: Command,
  directory: string,
  intervalMs: number,
  timeoutMs: number,
): Promise<void> {
  const { url, key, format } = builderVersionUrl(command, directory);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let data: unknown;
    try {
      data = await fetchVersion(url, key, 'status');
    } catch (error) {
      // Keep polling through a deploy's brief 502/503/504 until the deadline.
      if (!(error instanceof GatewayUnavailableError)) throw error;
      if (Date.now() >= deadline)
        throw new CliError(
          `${error.message}; run \`npx cavuno@latest builder status --wait\` again.`,
          11,
        );
      await new Promise((done) => setTimeout(done, intervalMs));
      continue;
    }
    const outcome = builderStatusOutcome(data);
    if (outcome) {
      print(data, format);
      if (outcome.ready) return;
      throw new CliError(outcome.reason, 7);
    }
    if (Date.now() >= deadline) {
      print(data, format);
      const held = (data as VersionStatus | null)?.publicExposure;
      throw new CliError(
        held?.state === 'held'
          ? `Version still held after ${timeoutMs}ms: ${held.reason ?? 'no reason given'}`
          : `Builder checks did not finish within ${timeoutMs}ms; run \`npx cavuno@latest builder status --wait\` again.`,
        11,
      );
    }
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

async function versionAction(
  command: Command,
  directory: string,
  action: 'status' | 'preview' | 'publish',
): Promise<void> {
  const { url, key, format } = builderVersionUrl(command, directory);
  print(await fetchVersion(url, key, action), format);
}

function positiveIntegerOption(flag: string, min: number, max: number) {
  return (raw: string): number => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new CliError(
        `${flag}: expected an integer from ${min} to ${max}, got ${raw}`,
        2,
      );
    return value;
  };
}

/** Exit codes from the README table. */
function exitCodeFor(status: number): number {
  const codes: Record<number, number> = {
    400: 2,
    401: 1,
    402: 5,
    403: 3,
    404: 4,
    409: 7,
    422: 2,
    429: 6,
  };
  return codes[status] ?? 10;
}

function apiErrorMessage(data: unknown): string | undefined {
  return data && typeof data === 'object' && 'error' in data
    ? (data as { error?: { message?: string } }).error?.message
    : undefined;
}

/** The one board this API key may use, from `GET /v1/builder/boards`. */
async function discoverBoardId(baseUrl: string, key: string): Promise<string> {
  const response = await fetch(`${baseUrl}/builder/boards`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new CliError(
      `Builder checkout failed (${response.status}): ${apiErrorMessage(data) ?? response.statusText}`,
      exitCodeFor(response.status),
    );
  const boardId = (data as { items?: Array<{ boardId?: unknown }> } | null)
    ?.items?.[0]?.boardId;
  if (typeof boardId !== 'string' || !boardId)
    throw new CliError('This API key has no Builder board.', 4);
  return boardId;
}

function assertDestination(destination: string): void {
  const stat = lstatSync(destination, { throwIfNoEntry: false });
  if (!stat) return;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    readdirSync(destination).length !== 0
  ) {
    throw new CliError('Checkout destination must be an empty directory.', 2);
  }
}

async function fetchSnapshot(
  url: string,
  key: string,
  init: RequestInit,
  action: 'checkout' | 'pull',
): Promise<Snapshot> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new CliError(
      `Builder ${action} failed (${response.status}): ${apiErrorMessage(data) ?? response.statusText}`,
      exitCodeFor(response.status),
    );
  }
  return (await response.json()) as Snapshot;
}

function decodeSnapshot(
  value: unknown,
  boardId: string,
  draftId: string,
): Array<{ path: string; bytes: Buffer; executable: boolean }> {
  if (!value || typeof value !== 'object')
    throw new CliError('Invalid Builder snapshot response.', 10);
  const data = value as Partial<Snapshot>;
  if (
    data.object !== 'builder_source_snapshot' ||
    data.boardId !== boardId ||
    data.draftId !== draftId ||
    typeof data.baseVersionId !== 'string' ||
    !data.baseVersionId ||
    !Array.isArray(data.files) ||
    data.files.length > MAX_FILES
  ) {
    throw new CliError(
      'Invalid Builder snapshot response or board/draft mismatch.',
      10,
    );
  }
  const seen = new Set<string>();
  let size = 0;
  const files = data.files.map((file) => {
    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.contentsBase64 !== 'string' ||
      typeof file.executable !== 'boolean'
    ) {
      throw new CliError('Invalid Builder snapshot file.', 10);
    }
    const path = file.path;
    const parts = path.split('/');
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.includes(':') ||
      /[\u0000-\u001f\u007f]/.test(path) ||
      path !== path.normalize('NFC') ||
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.endsWith('.') ||
          part.endsWith(' ') ||
          part.toLowerCase() === '.git',
      )
    ) {
      throw new CliError(`Unsafe Builder snapshot path: ${path}`, 10);
    }
    const folded = path.toLowerCase();
    if (seen.has(folded))
      throw new CliError(`Duplicate Builder snapshot path: ${path}`, 10);
    seen.add(folded);
    // The round trip is the canonical check; no regex (V8 overflows its
    // stack on base64 patterns for files over ~3.2 MiB).
    const bytes = Buffer.from(file.contentsBase64, 'base64');
    if (bytes.toString('base64') !== file.contentsBase64) {
      throw new CliError(
        `Invalid base64 for Builder snapshot path: ${path}`,
        10,
      );
    }
    if (
      (isBuilderCredentialPath(path) && !isApprovedBuilderConfigPath(path)) ||
      (isApprovedBuilderConfigPath(path) && !isSafeBuilderConfig(path, bytes))
    )
      throw new CliError(`Unsafe Builder snapshot configuration: ${path}`, 10);
    if (bytes.length > MAX_FILE_BYTES)
      throw new CliError(`Builder snapshot file exceeds limit: ${path}`, 10);
    size += bytes.length;
    if (size > MAX_BYTES)
      throw new CliError('Builder snapshot exceeds checkout size limit.', 10);
    return { path, bytes, executable: file.executable };
  });
  for (const { path } of files) {
    const parts = path.toLowerCase().split('/');
    for (let i = 1; i < parts.length; i++) {
      if (seen.has(parts.slice(0, i).join('/')))
        throw new CliError(
          `File/directory collision in Builder snapshot path: ${path}`,
          10,
        );
    }
  }
  return files;
}

export function registerBuilderCommand(root: Command): void {
  const builder = root
    .command('builder')
    .description(
      `Work with a Builder draft from a coding agent. Needs CAVUNO_API_KEY with Builder: read, manage, or publish. Run as \`npx cavuno@latest builder …\`. Guide: ${DOCS_URL}`,
    );
  annotate(
    builder
      .command('checkout')
      .description(
        "Create a draft from live or check out an existing Builder draft. Without a board ID, uses the API key's board.",
      )
      .argument('[board-id]', "Board ID (default: the API key's board)")
      .option(
        '--draft <draft-id>',
        "Existing draft ID, or the ID at the end of the task's Builder URL (default: create from live)",
      )
      .option(
        '--directory <path>',
        'Destination directory (default: ./<board-id>-builder or ./<board-id>-<draft-id>)',
      )
      .action(async function (
        this: Command,
        boardIdArgument: string | undefined,
        opts: { draft?: string; directory?: string },
      ) {
        if (opts.directory) assertDestination(resolve(opts.directory));
        const key = builderApiKey();
        const global = this.optsWithGlobals<{
          apiUrl?: string;
          format?: 'json' | 'table';
        }>();
        const baseUrl = (
          global.apiUrl ??
          process.env.CAVUNO_API_URL ??
          'https://api.cavuno.com/v1'
        ).replace(/\/+$/, '');
        const boardId =
          boardIdArgument || (await discoverBoardId(baseUrl, key));
        const destinationName = `${boardId}-${opts.draft ?? 'builder'}`;
        if (!opts.directory && !/^[A-Za-z0-9_-]+$/.test(destinationName)) {
          throw new CliError('Use --directory for this board/draft ID.', 2);
        }
        const destination = resolve(opts.directory ?? destinationName);
        assertDestination(destination);
        const draftsUrl = `${baseUrl}/builder/boards/${encodeURIComponent(boardId)}/drafts`;
        const url = opts.draft
          ? `${draftsUrl}/${encodeURIComponent(opts.draft)}/snapshot`
          : draftsUrl;
        const snapshot = await fetchSnapshot(
          url,
          key,
          opts.draft ? {} : { method: 'POST' },
          'checkout',
        );
        const draftId = opts.draft ?? snapshot.draftId;
        const files = decodeSnapshot(snapshot, boardId, draftId);
        assertDestination(destination);
        mkdirSync(destination, { recursive: true });
        for (const file of files) {
          const target = join(destination, file.path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, file.bytes, {
            flag: 'wx',
            mode: file.executable ? 0o755 : 0o644,
          });
          chmodSync(target, file.executable ? 0o755 : 0o644);
        }
        try {
          // The snapshot is the starting tree, not a directory of untracked
          // files. builderGit ignores the caller's filters, hooks, and signing
          // settings so checking out source never executes a Git integration.
          builderGit(destination, [
            '-c',
            'init.templateDir=/dev/null',
            'init',
            '--quiet',
          ]);
          // Force-add the exact export even if its own .gitignore matches a
          // source file. The local manifest lives inside .git and stays out.
          builderGit(destination, ['add', '--all', '--force', '--', '.']);
          builderGit(destination, [
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            'Cavuno Builder checkout',
          ]);
          builderGit(destination, ['update-ref', BASE_REF, 'HEAD']);
        } catch (error) {
          throw new CliError(
            `Could not prepare local Git repository: ${error instanceof Error ? error.message : 'git failed'}`,
            10,
          );
        }
        writeFileSync(
          join(destination, '.git', 'cavuno-builder.json'),
          `${JSON.stringify({ boardId, draftId, baseVersionId: snapshot.baseVersionId }, null, 2)}\n`,
          { flag: 'wx', mode: 0o600 },
        );
        print(
          {
            directory: destination,
            boardId,
            draftId,
            baseVersionId: snapshot.baseVersionId,
          },
          global.format ?? 'json',
        );
      }),
    {
      mapsTo:
        'GET /v1/builder/boards; POST /v1/builder/boards/:boardId/drafts; GET /v1/builder/boards/:boardId/drafts/:draftId/snapshot',
      examples: [
        'npx cavuno@latest builder checkout',
        'npx cavuno@latest builder checkout <board-id> --draft <draft-id>',
      ],
    },
  );
  annotate(
    builder
      .command('submit')
      .description(
        'Submit local Builder source, including uncommitted edits, for the checked-out draft. Sends the files Git sees (tracked plus untracked, minus .gitignore matches). On stale_base, run builder pull, then submit again.',
      )
      .option(
        '--directory <path>',
        'Builder checkout directory (default: current directory)',
      )
      .action(async function (this: Command, opts: { directory?: string }) {
        const directory = resolve(opts.directory ?? '.');
        promotePendingBase(directory);
        const { manifest, files, body, idempotencyKey } =
          buildBuilderSubmission(directory);
        const key = builderApiKey();
        const global = this.optsWithGlobals<{
          apiUrl?: string;
          format?: 'json' | 'table';
        }>();
        const baseUrl = (
          global.apiUrl ??
          process.env.CAVUNO_API_URL ??
          'https://api.cavuno.com/v1'
        ).replace(/\/+$/, '');
        const url = `${baseUrl}/builder/boards/${encodeURIComponent(manifest.boardId)}/drafts/${encodeURIComponent(manifest.draftId)}/submissions/staged`;
        const created = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            baseVersionId: manifest.baseVersionId,
            idempotencyKey,
            payloadDigest: createHash('sha256').update(body).digest('hex'),
          }),
        });
        const createdData: unknown = await created.json().catch(() => null);
        if (
          !created.ok ||
          !createdData ||
          typeof createdData !== 'object' ||
          typeof (createdData as { operationId?: unknown }).operationId !==
            'string'
        ) {
          const error =
            createdData &&
            typeof createdData === 'object' &&
            'error' in createdData
              ? (createdData as { error?: { code?: string; message?: string } })
                  .error
              : undefined;
          throw new CliError(
            `Builder submit create failed (${created.status}): ${error?.message ?? created.statusText}${
              error?.code === 'stale_base' ? STALE_BASE_NEXT_STEP : ''
            }`,
            exitCodeFor(created.status),
          );
        }
        const operationId = (createdData as { operationId: string })
          .operationId;
        const operationUrl = `${url}/${encodeURIComponent(operationId)}`;
        const status = (createdData as { status?: unknown }).status;
        if (status === 'created') {
          const upload = await fetch(`${operationUrl}/payload`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
            },
            body,
          });
          if (!upload.ok) {
            const detail: unknown = await upload.json().catch(() => null);
            throw new CliError(
              `Builder submit upload failed (${upload.status}): ${apiErrorMessage(detail) ?? upload.statusText}`,
              exitCodeFor(upload.status),
            );
          }
        }
        const response = await fetch(`${operationUrl}/complete`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
        });
        const data: unknown = await response.json().catch(() => null);
        const kind =
          data && typeof data === 'object' && 'kind' in data
            ? (data as { kind: unknown }).kind
            : null;
        if (response.ok && (kind === 'accepted' || kind === 'no_changes')) {
          if (kind === 'accepted') {
            const versionId = (data as { versionId?: unknown }).versionId;
            if (typeof versionId !== 'string') {
              throw new CliError('Builder submit returned no version ID.', 10);
            }
            advanceBuilderManifest(directory, manifest, versionId);
            try {
              recordSubmittedBase(directory, files);
            } catch {
              process.stderr.write(
                'Warning: could not record the submitted tree in local Git; the next pull merges from an older base.\n',
              );
            }
          }
          print(data, global.format ?? 'json');
          return;
        }
        if (
          typeof kind === 'string' &&
          [
            'refused',
            'stale_base',
            'busy',
            'in_progress',
            'recovery_conflict',
            'key_conflict',
          ].includes(kind)
        ) {
          const detail = data as {
            reason?: unknown;
            path?: unknown;
            currentVersionId?: unknown;
            submissionId?: unknown;
          };
          const context = [
            detail.reason,
            detail.path,
            detail.currentVersionId,
            detail.submissionId,
          ]
            .filter((item): item is string => typeof item === 'string')
            .join(' ');
          throw new CliError(
            `Builder submit ${kind}${context ? `: ${context}` : ''}${
              kind === 'stale_base' ? STALE_BASE_NEXT_STEP : ''
            }`,
            exitCodeFor(response.status),
          );
        }
        const error =
          data && typeof data === 'object' && 'error' in data
            ? (data as { error?: { code?: string; message?: string } }).error
            : undefined;
        throw new CliError(
          `Builder submit failed (${response.status}): ${error?.message ?? response.statusText}`,
          error?.code === 'daily_build_limit'
            ? 5
            : exitCodeFor(response.status),
        );
      }),
    {
      mapsTo:
        'POST /v1/builder/boards/:boardId/drafts/:draftId/submissions/staged',
      examples: [
        'npx cavuno@latest builder submit',
        'npx cavuno@latest builder submit --directory ./my-checkout',
      ],
    },
  );
  annotate(
    builder
      .command('pull')
      .description(
        "Merge the draft's current version into committed local work, like git pull. After a publish elsewhere, pull then submit (even unchanged) to make the caught-up version publishable.",
      )
      .option(
        '--directory <path>',
        'Builder checkout directory (default: current directory)',
      )
      .action(async function (this: Command, opts: { directory?: string }) {
        const directory = resolve(opts.directory ?? '.');
        readBuilderManifest(directory);
        const git = (args: string[]) => builderGit(directory, args);
        if (git(['status', '--porcelain']))
          throw new CliError(
            'Commit or remove local changes before `npx cavuno@latest builder pull`.',
            2,
          );
        const manifest = promotePendingBase(directory);
        const key = builderApiKey();
        const global = this.optsWithGlobals<{
          apiUrl?: string;
          format?: 'json' | 'table';
        }>();
        const baseUrl = (
          global.apiUrl ??
          process.env.CAVUNO_API_URL ??
          'https://api.cavuno.com/v1'
        ).replace(/\/+$/, '');
        const snapshot = await fetchSnapshot(
          `${baseUrl}/builder/boards/${encodeURIComponent(manifest.boardId)}/drafts/${encodeURIComponent(manifest.draftId)}/snapshot`,
          key,
          {},
          'pull',
        );
        const files = decodeSnapshot(
          snapshot,
          manifest.boardId,
          manifest.draftId,
        );
        const versionId = snapshot.baseVersionId;
        const result = {
          directory,
          boardId: manifest.boardId,
          draftId: manifest.draftId,
          baseVersionId: versionId,
        };
        if (versionId === manifest.baseVersionId) {
          print({ ...result, status: 'up_to_date' }, global.format ?? 'json');
          return;
        }
        // The pulled version as a child of the current base, merged against
        // that base explicitly so only Cavuno's changes since it apply.
        const base = git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
        const pulled = commitBuilderTree(
          directory,
          PENDING_REF,
          base,
          files,
          `Cavuno Builder version ${versionId}`,
        );
        let conflicts: string;
        try {
          conflicts = mergePulledVersion(
            directory,
            base,
            pulled,
            `Merge Cavuno Builder version ${versionId}`,
          );
        } catch (error) {
          git(['update-ref', '-d', PENDING_REF]);
          throw new CliError(
            `Builder pull could not merge version ${versionId}: ${error instanceof Error ? error.message : 'git merge failed'}`,
            10,
          );
        }
        if (conflicts) {
          // Submit takes the pulled base once the resolved merge is committed.
          writeBuilderManifest(directory, {
            boardId: manifest.boardId,
            draftId: manifest.draftId,
            baseVersionId: manifest.baseVersionId,
            pendingBaseVersionId: versionId,
          });
          throw new CliError(
            `Builder pull merged version ${versionId} with conflicts in:\n${conflicts}\nResolve them, commit, then run \`npx cavuno@latest builder submit\`.`,
            7,
          );
        }
        git(['update-ref', BASE_REF, pulled]);
        git(['update-ref', '-d', PENDING_REF]);
        writeBuilderManifest(directory, {
          boardId: manifest.boardId,
          draftId: manifest.draftId,
          baseVersionId: versionId,
        });
        print(
          {
            ...result,
            previousBaseVersionId: manifest.baseVersionId,
            status: 'merged',
          },
          global.format ?? 'json',
        );
      }),
    {
      mapsTo: 'GET /v1/builder/boards/:boardId/drafts/:draftId/snapshot',
      examples: [
        'npx cavuno@latest builder pull',
        'npx cavuno@latest builder pull --directory ./my-checkout',
      ],
    },
  );
  annotate(
    builder
      .command('status')
      .description(
        'Read the current submitted version, check, and publish status. With --wait, poll until checks finish: exit 0 when the version is verified and cleared to publish, 7 with the reason when it failed or was flagged.',
      )
      .option(
        '--directory <path>',
        'Builder checkout directory (default: current directory)',
      )
      .option('--wait', 'Poll until the checks reach a final state')
      .option(
        '--interval-ms <n>',
        'Poll interval in milliseconds with --wait (default 10000)',
        positiveIntegerOption('--interval-ms', 1000, 600_000),
      )
      .option(
        '--timeout-ms <n>',
        'Give up waiting after this many milliseconds (default 1200000)',
        positiveIntegerOption('--timeout-ms', 1000, 86_400_000),
      )
      .action(async function (
        this: Command,
        opts: {
          directory?: string;
          wait?: boolean;
          intervalMs?: number;
          timeoutMs?: number;
        },
      ) {
        if (!opts.wait) {
          await versionAction(this, opts.directory ?? '.', 'status');
          return;
        }
        await waitForVersion(
          this,
          opts.directory ?? '.',
          opts.intervalMs ?? 10_000,
          opts.timeoutMs ?? 1_200_000,
        );
      }),
    {
      mapsTo:
        'GET /v1/builder/boards/:boardId/drafts/:draftId/versions/:versionId/status',
      examples: [
        'npx cavuno@latest builder status',
        'npx cavuno@latest builder status --wait',
      ],
    },
  );
  for (const action of ['preview', 'publish'] as const) {
    const description = {
      preview: 'Mint a one-use private preview URL for the current version.',
      publish:
        'Queue the current submitted version through the full Go Live gate.',
    }[action];
    annotate(
      builder
        .command(action)
        .description(description)
        .option(
          '--directory <path>',
          'Builder checkout directory (default: current directory)',
        )
        .action(async function (this: Command, opts: { directory?: string }) {
          await versionAction(this, opts.directory ?? '.', action);
        }),
      {
        mapsTo: `${action === 'publish' ? 'POST' : 'GET'} /v1/builder/boards/:boardId/drafts/:draftId/versions/:versionId/${action}`,
        examples: [`npx cavuno@latest builder ${action}`],
      },
    );
  }
}
