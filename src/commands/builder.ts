import { Command } from 'commander';

import { annotate } from '../lib/annotate.js';
import { CliError } from '../lib/auth.js';
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

const BUILDER_KEY = /^cavuno_builder_[0-9a-f]{64}$/;
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_BYTES = 128 * 1024 * 1024;
const STALE_BASE_NEXT_STEP =
  '. Run `cavuno builder pull`, resolve any conflicts and commit, then submit again.';

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

function checkedBuilderKey(): string {
  const key = process.env.CAVUNO_BUILDER_KEY;
  if (!key || !BUILDER_KEY.test(key)) {
    throw new CliError(
      'CAVUNO_BUILDER_KEY must be a valid board-scoped Builder key.',
      1,
    );
  }
  return key;
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
  const key = checkedBuilderKey();
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

async function versionAction(
  command: Command,
  directory: string,
  action: 'status' | 'preview' | 'publish',
): Promise<void> {
  const { url, key, format } = builderVersionUrl(command, directory);
  const response = await fetch(`${url}/${action}`, {
    method: action === 'publish' ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}` },
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? (data as { error?: { message?: string } }).error?.message
        : undefined;
    throw new CliError(
      `Builder ${action} failed (${response.status}): ${message ?? response.statusText}`,
      response.status === 401
        ? 1
        : response.status === 403
          ? 3
          : response.status === 404
            ? 4
            : 10,
    );
  }
  print(data, format);
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
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new CliError(
      `Builder ${action} failed (${response.status}): ${body?.error?.message ?? response.statusText}`,
      response.status === 401
        ? 1
        : response.status === 403
          ? 3
          : response.status === 404
            ? 4
            : 10,
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
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.contentsBase64,
      )
    ) {
      throw new CliError(
        `Invalid base64 for Builder snapshot path: ${path}`,
        10,
      );
    }
    const bytes = Buffer.from(file.contentsBase64, 'base64');
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
    .description('Work with an authorized Builder draft.');
  annotate(
    builder
      .command('checkout')
      .description(
        'Create a draft from live or check out an existing Builder draft.',
      )
      .argument('<board-id>', 'Board ID')
      .option(
        '--draft <draft-id>',
        'Existing draft ID (default: create from live)',
      )
      .option(
        '--directory <path>',
        'Destination directory (default: ./<board-id>-builder or ./<board-id>-<draft-id>)',
      )
      .action(async function (
        this: Command,
        boardId: string,
        opts: { draft?: string; directory?: string },
      ) {
        if (!boardId) throw new CliError('Board ID is required.', 2);
        const destinationName = `${boardId}-${opts.draft ?? 'builder'}`;
        if (!opts.directory && !/^[A-Za-z0-9_-]+$/.test(destinationName)) {
          throw new CliError('Use --directory for this board/draft ID.', 2);
        }
        const destination = resolve(opts.directory ?? destinationName);
        assertDestination(destination);
        const key = checkedBuilderKey();
        const global = this.optsWithGlobals<{
          apiUrl?: string;
          format?: 'json' | 'table';
        }>();
        const baseUrl = (
          global.apiUrl ??
          process.env.CAVUNO_API_URL ??
          'https://api.cavuno.com/v1'
        ).replace(/\/+$/, '');
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
        'POST /v1/builder/boards/:boardId/drafts; GET /v1/builder/boards/:boardId/drafts/:draftId/snapshot',
      examples: [
        'cavuno builder checkout <board-id>',
        'cavuno builder checkout <board-id> --draft <draft-id>',
      ],
    },
  );
  annotate(
    builder
      .command('submit')
      .description(
        'Submit local Builder source, including uncommitted edits, for the checked-out draft. On stale_base, run builder pull, then submit again.',
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
        const key = checkedBuilderKey();
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
            created.status === 401 ? 1 : 3,
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
            const message =
              detail && typeof detail === 'object' && 'error' in detail
                ? (detail as { error?: { message?: string } }).error?.message
                : undefined;
            throw new CliError(
              `Builder submit upload failed (${upload.status}): ${message ?? upload.statusText}`,
              upload.status === 422 ? 2 : 3,
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
            response.status === 422 ? 2 : 3,
          );
        }
        const error =
          data && typeof data === 'object' && 'error' in data
            ? (data as { error?: { message?: string } }).error
            : undefined;
        throw new CliError(
          `Builder submit failed (${response.status}): ${error?.message ?? response.statusText}`,
          response.status === 401
            ? 1
            : response.status === 403
              ? 3
              : response.status === 404
                ? 4
                : 10,
        );
      }),
    {
      mapsTo:
        'POST /v1/builder/boards/:boardId/drafts/:draftId/submissions/staged',
      examples: [
        'cavuno builder submit',
        'cavuno builder submit --directory ./my-checkout',
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
            'Commit or remove local changes before `cavuno builder pull`.',
            2,
          );
        const manifest = promotePendingBase(directory);
        const key = checkedBuilderKey();
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
            `Builder pull merged version ${versionId} with conflicts in:\n${conflicts}\nResolve them, commit, then run \`cavuno builder submit\`.`,
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
        'cavuno builder pull',
        'cavuno builder pull --directory ./my-checkout',
      ],
    },
  );
  for (const action of ['status', 'preview', 'publish'] as const) {
    const description = {
      status: 'Read the current submitted version, check, and publish status.',
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
        examples: [`cavuno builder ${action}`],
      },
    );
  }
}
