import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCliProgram } from '../program.js';

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = `cavuno_live_${'a'.repeat(16)}_${'s'.repeat(32)}`;

describe('builder submit CLI', () => {
  let directory: string;
  let previousKey: string | undefined;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cavuno-cli-submit-'));
    mkdirSync(join(directory, '.git'));
    writeFileSync(
      join(directory, '.git', 'cavuno-builder.json'),
      JSON.stringify({
        boardId: 'board_1',
        draftId: 'draft_1',
        baseVersionId: 'version_1',
      }),
    );
    writeFileSync(join(directory, 'package.json'), '{"name":"site"}\n');
    writeFileSync(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    previousKey = process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_KEY = KEY;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/staged'))
        return Response.json(
          { operationId: 'operation_1', status: 'created' },
          { status: 201 },
        );
      if (path.endsWith('/payload'))
        return Response.json({
          operationId: 'operation_1',
          status: 'uploaded',
        });
      return Response.json({
        kind: 'accepted',
        versionId: 'version_2',
        candidateQueued: true,
      });
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = previousKey;
  });

  async function run() {
    await createCliProgram('test')
      .exitOverride()
      .parseAsync(
        [
          'node',
          'cavuno',
          '--api-url',
          'https://example.test/api/v1',
          'builder',
          'submit',
          '--directory',
          directory,
        ],
        { from: 'node' },
      );
  }

  it('submits edited and untracked source and advances the local base after acceptance', async () => {
    mkdirSync(join(directory, 'src'));
    writeFileSync(
      join(directory, 'src', 'new.ts'),
      'export const edited = true;\n',
    );
    writeFileSync(join(directory, '.env.local'), 'SECRET=private');
    writeFileSync(join(directory, '.pnpmfile.mjs'), 'export const hooks = {};');
    mkdirSync(join(directory, 'node_modules'));
    writeFileSync(join(directory, 'node_modules', 'ignored.js'), 'ignored');
    await run();
    vi.mocked(globalThis.fetch)
      .mockImplementationOnce(async () =>
        Response.json(
          { operationId: 'operation_2', status: 'created' },
          { status: 201 },
        ),
      )
      .mockImplementationOnce(async () =>
        Response.json({ operationId: 'operation_2', status: 'uploaded' }),
      )
      .mockImplementationOnce(async () =>
        Response.json({ kind: 'no_changes' }),
      );
    await run();
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls).toHaveLength(6);
    expect(calls[0]?.[0]).toBe(
      'https://example.test/api/v1/builder/boards/board_1/drafts/draft_1/submissions/staged',
    );
    const request = calls[0]![1]!;
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      }),
    );
    const firstCreate = JSON.parse(request.body as string) as {
      idempotencyKey: string;
      baseVersionId: string;
      payloadDigest: string;
    };
    const secondCreate = JSON.parse(calls[3]![1]!.body as string) as {
      idempotencyKey: string;
      baseVersionId: string;
    };
    expect(secondCreate.idempotencyKey).not.toBe(firstCreate.idempotencyKey);
    const body = JSON.parse(calls[1]![1]!.body as string) as {
      baseVersionId: string;
      source: {
        format: string;
        files: Array<{
          path: string;
          contentsBase64: string;
          executable: boolean;
        }>;
      };
    };
    expect(body.baseVersionId).toBe('version_1');
    expect(secondCreate).toMatchObject({
      baseVersionId: 'version_2',
    });
    expect(firstCreate.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[2]?.[0]).toBe(
      'https://example.test/api/v1/builder/boards/board_1/drafts/draft_1/submissions/staged/operation_1/complete',
    );
    expect(
      JSON.parse(
        readFileSync(join(directory, '.git', 'cavuno-builder.json'), 'utf8'),
      ),
    ).toMatchObject({
      baseVersionId: 'version_2',
    });
    expect(body.source.format).toBe('cavuno-builder-source-v1');
    expect(body.source.files.map((file) => file.path)).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'src/new.ts',
    ]);
    expect(
      Buffer.from(body.source.files[2]!.contentsBase64, 'base64').toString(),
    ).toBe('export const edited = true;\n');
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify(
        { kind: 'accepted', versionId: 'version_2', candidateQueued: true },
        null,
        2,
      ),
    );
  });

  it('refuses symlinks before sending any source', async () => {
    symlinkSync(
      join(directory, 'package.json'),
      join(directory, 'linked.json'),
    );
    await expect(run()).rejects.toThrow(/symbolic link/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('submits source nested under build-named directories but omits root build output', async () => {
    mkdirSync(join(directory, 'src', 'build'), { recursive: true });
    mkdirSync(join(directory, 'public', 'dist'), { recursive: true });
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'src', 'build', 'page.ts'), 'export {}\n');
    writeFileSync(join(directory, 'public', 'dist', 'logo.svg'), '<svg/>\n');
    writeFileSync(join(directory, 'dist', 'generated.js'), 'generated\n');

    await run();

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[1]![1]!.body as string,
    ) as { source: { files: Array<{ path: string }> } };
    expect(body.source.files.map((file) => file.path)).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'public/dist/logo.svg',
      'src/build/page.ts',
    ]);
  });

  it('requires a valid checkout manifest and CAVUNO_API_KEY', async () => {
    rmSync(join(directory, '.git', 'cavuno-builder.json'));
    await expect(run()).rejects.toThrow(/manifest/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    writeFileSync(
      join(directory, '.git', 'cavuno-builder.json'),
      JSON.stringify({
        boardId: 'board_1',
        draftId: 'draft_1',
        baseVersionId: 'version_1',
      }),
    );
    delete process.env.CAVUNO_API_KEY;
    await expect(run()).rejects.toThrow(/CAVUNO_API_KEY/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('reports a stale base with the current version', async () => {
    vi.mocked(globalThis.fetch)
      .mockImplementationOnce(async () =>
        Response.json(
          { operationId: 'operation_1', status: 'created' },
          { status: 201 },
        ),
      )
      .mockImplementationOnce(async () =>
        Response.json({ operationId: 'operation_1', status: 'uploaded' }),
      )
      .mockImplementationOnce(async () =>
        Response.json(
          { kind: 'stale_base', currentVersionId: 'version_2' },
          { status: 409 },
        ),
      );
    await expect(run()).rejects.toThrow(/stale_base: version_2/);
  });

  it('tells the agent to pull when create already sees a stale base', async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () =>
      Response.json(
        { error: { code: 'stale_base', message: 'Draft base changed' } },
        { status: 409 },
      ),
    );
    await expect(run()).rejects.toThrow(
      /Draft base changed\. Run `cavuno builder pull`/,
    );
  });

  it('changes the idempotency key when source changes and accepts no_changes', async () => {
    await run();
    const firstKey = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0]![1]!.body as string,
    ).idempotencyKey;
    writeFileSync(join(directory, 'new-file.ts'), 'export {};\n');
    vi.mocked(globalThis.fetch)
      .mockImplementationOnce(async () =>
        Response.json(
          { operationId: 'operation_2', status: 'created' },
          { status: 201 },
        ),
      )
      .mockImplementationOnce(async () =>
        Response.json({ operationId: 'operation_2', status: 'uploaded' }),
      )
      .mockImplementationOnce(async () =>
        Response.json({ kind: 'no_changes' }),
      );
    await run();
    const secondKey = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[3]![1]!.body as string,
    ).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
    expect(console.log).toHaveBeenLastCalledWith(
      JSON.stringify({ kind: 'no_changes' }, null, 2),
    );
  });

  it('keeps the same retry key after an unconfirmed network failure', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new Error('connection lost'),
    );
    await expect(run()).rejects.toThrow('connection lost');
    await run();
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(JSON.parse(calls[0]![1]!.body as string).idempotencyKey).toBe(
      JSON.parse(calls[1]![1]!.body as string).idempotencyKey,
    );
  });
});
