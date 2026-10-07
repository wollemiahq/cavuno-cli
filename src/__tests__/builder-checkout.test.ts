import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { packageBuilderSource } from '../commands/builder-submit.js';
import { createCliProgram } from '../program.js';

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  existsSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = `cavuno_live_${'a'.repeat(16)}_${'s'.repeat(32)}`;
const snapshot = {
  object: 'builder_source_snapshot',
  boardId: 'board_1',
  draftId: 'draft_1',
  baseVersionId: 'version_1',
  files: [
    {
      path: '.gitignore',
      contentsBase64: Buffer.from('node_modules/\n').toString('base64'),
      executable: false,
    },
    {
      path: 'src/index.ts',
      contentsBase64: Buffer.from('export {};\n').toString('base64'),
      executable: false,
    },
    {
      path: 'scripts/run.sh',
      contentsBase64: Buffer.from('#!/bin/sh\n').toString('base64'),
      executable: true,
    },
  ],
};

describe('builder checkout CLI', () => {
  let directory: string;
  let previousKey: string | undefined;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cavuno-cli-checkout-'));
    previousKey = process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_KEY = KEY;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(snapshot));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = previousKey;
  });

  async function run(...args: string[]) {
    await createCliProgram('test')
      .exitOverride()
      .parseAsync(
        [
          'node',
          'cavuno',
          '--api-url',
          'https://example.test/api/v1',
          'builder',
          'checkout',
          'board_1',
          '--draft',
          'draft_1',
          '--directory',
          join(directory, 'checkout'),
          ...args,
        ],
        { from: 'node' },
      );
  }

  it('preserves approved starter configuration bytes through checkout and packaging', async () => {
    const configs = {
      '.cavuno/locale-setup.json': '{"locale":"en"}\n',
      '.npmrc': '# platform enforces age\nmin-release-age=0\n',
      '.dev.vars.example':
        'CAVUNO_API_URL="https://api.cavuno.com/v1"\nCAVUNO_BOARD=pk_example\nCAVUNO_DEV_TOOLS=true\n',
    };
    const files = Object.entries(configs).map(([path, contents]) => ({
      path,
      contentsBase64: Buffer.from(contents).toString('base64'),
      executable: false,
    }));
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({ ...snapshot, files: [...snapshot.files, ...files] }),
    );
    await run();
    const packaged = packageBuilderSource(join(directory, 'checkout')).files;
    for (const file of files) expect(packaged).toContainEqual(file);
  });

  it.each([
    ['.npmrc', '//registry.npmjs.org/:_authToken=secret'],
    ['.npmrc', 'min-release-age=1\nmin-release-age=2'],
    ['.dev.vars.example', 'CAVUNO_BOARD=sk_secret'],
    ['.dev.vars.example', 'CAVUNO_API_URL=https://user:pass@example.com'],
    ['.dev.vars.example', 'CAVUNO_API_URL=https://example.com?token=secret'],
    ['.dev.vars.example', 'CAVUNO_BOARD=${TOKEN}'],
    ['.dev.vars.example', 'SECRET=secret'],
    ['.dev.vars.example', 'CAVUNO_DEV_TOOLS=true\nCAVUNO_DEV_TOOLS=false'],
    ['.cavuno/unknown.json', '{}'],
    ['nested/.npmrc', 'min-release-age=0'],
    ['.NPMRC', 'min-release-age=0'],
    ['.dev.vars', 'CAVUNO_BOARD=pk_example'],
  ])('refuses unsafe checkout config %s (%s)', async (path, contents) => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({
        ...snapshot,
        files: [
          {
            path,
            contentsBase64: Buffer.from(contents).toString('base64'),
            executable: false,
          },
        ],
      }),
    );
    await expect(run()).rejects.toThrow(/Unsafe Builder/);
  });

  it('creates a new draft from live when --draft is omitted', async () => {
    await createCliProgram('test')
      .exitOverride()
      .parseAsync(
        [
          'node',
          'cavuno',
          '--api-url',
          'https://example.test/api/v1',
          'builder',
          'checkout',
          'board_1',
          '--directory',
          join(directory, 'new'),
        ],
        { from: 'node' },
      );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.test/api/v1/builder/boards/board_1/drafts',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(
      JSON.parse(
        readFileSync(join(directory, 'new/.git/cavuno-builder.json'), 'utf8'),
      ),
    ).toEqual({
      boardId: 'board_1',
      draftId: 'draft_1',
      baseVersionId: 'version_1',
    });
  });

  it("uses the API key's board when the board ID is omitted", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        Response.json({
          object: 'list',
          items: [
            {
              boardId: 'board_1',
              rights: { read: true, write: true, publish: false },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(snapshot));
    const cwd = process.cwd();
    process.chdir(directory);
    try {
      await createCliProgram('test')
        .exitOverride()
        .parseAsync(
          [
            'node',
            'cavuno',
            '--api-url',
            'https://example.test/api/v1',
            'builder',
            'checkout',
          ],
          { from: 'node' },
        );
    } finally {
      process.chdir(cwd);
    }
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls[0]?.[0]).toBe('https://example.test/api/v1/builder/boards');
    expect(calls[1]?.[0]).toBe(
      'https://example.test/api/v1/builder/boards/board_1/drafts',
    );
    expect(
      JSON.parse(
        readFileSync(
          join(directory, 'board_1-builder/.git/cavuno-builder.json'),
          'utf8',
        ),
      ),
    ).toMatchObject({ boardId: 'board_1', draftId: 'draft_1' });
  });

  it.each([
    [403, 'local_agent_not_enabled', 3],
    [402, 'plan_upgrade_required', 5],
  ])(
    'reports why the API key has no usable board (%i)',
    async (status, code, exitCode) => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        Response.json(
          { error: { code, message: 'Coding agents are in early access.' } },
          { status },
        ),
      );
      await expect(
        createCliProgram('test')
          .exitOverride()
          .parseAsync(
            [
              'node',
              'cavuno',
              '--api-url',
              'https://example.test/api/v1',
              'builder',
              'checkout',
              '--directory',
              join(directory, 'none'),
            ],
            { from: 'node' },
          ),
      ).rejects.toMatchObject({
        message: `Builder checkout failed (${status}): Coding agents are in early access.`,
        exitCode,
      });
      expect(existsSync(join(directory, 'none'))).toBe(false);
    },
  );

  it('checks out a file larger than the regex stack limit', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 7);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({
        ...snapshot,
        files: [
          ...snapshot.files,
          {
            path: 'public/hero.bin',
            contentsBase64: big.toString('base64'),
            executable: false,
          },
        ],
      }),
    );
    await run();
    expect(
      readFileSync(join(directory, 'checkout/public/hero.bin')).equals(big),
    ).toBe(true);
  });

  it('exports the exact draft into a normal local Git repository', async () => {
    await run();
    const checkout = join(directory, 'checkout');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.test/api/v1/builder/boards/board_1/drafts/draft_1/snapshot',
      expect.objectContaining({ headers: { Authorization: `Bearer ${KEY}` } }),
    );
    expect(readFileSync(join(checkout, 'src/index.ts'), 'utf8')).toBe(
      'export {};\n',
    );
    expect(readFileSync(join(checkout, '.gitignore'), 'utf8')).toBe(
      'node_modules/\n',
    );
    expect(
      statSync(join(checkout, 'scripts/run.sh')).mode & 0o111,
    ).toBeTruthy();
    expect(
      JSON.parse(
        readFileSync(join(checkout, '.git/cavuno-builder.json'), 'utf8'),
      ),
    ).toEqual({
      boardId: 'board_1',
      draftId: 'draft_1',
      baseVersionId: 'version_1',
    });
    expect(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: checkout,
        encoding: 'utf8',
      }).trim(),
    ).toMatch(/^[0-9a-f]{40,64}$/);
    expect(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: checkout,
        encoding: 'utf8',
      }),
    ).toBe('');
    writeFileSync(
      join(checkout, 'src/index.ts'),
      'export const edited = true;\n',
    );
    expect(
      execFileSync('git', ['diff', '--name-only'], {
        cwd: checkout,
        encoding: 'utf8',
      }).trim(),
    ).toBe('src/index.ts');
    expect(
      readFileSync(join(checkout, '.git/cavuno-builder.json'), 'utf8'),
    ).not.toContain(KEY);
  });

  it('tracks every exported file even when the snapshot ignores it', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      Response.json({
        ...snapshot,
        files: snapshot.files.map((file) =>
          file.path === '.gitignore'
            ? {
                ...file,
                contentsBase64: Buffer.from('src/\n').toString('base64'),
              }
            : file,
        ),
      }),
    );
    await run();
    const checkout = join(directory, 'checkout');
    expect(
      execFileSync('git', ['ls-files', '--', 'src/index.ts'], {
        cwd: checkout,
        encoding: 'utf8',
      }).trim(),
    ).toBe('src/index.ts');
    expect(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: checkout,
        encoding: 'utf8',
      }),
    ).toBe('');
  });

  it('ignores an inherited Git namespace when creating the baseline', async () => {
    const previousNamespace = process.env.GIT_NAMESPACE;
    process.env.GIT_NAMESPACE = 'other-repository-namespace';
    try {
      await run();
    } finally {
      if (previousNamespace === undefined) delete process.env.GIT_NAMESPACE;
      else process.env.GIT_NAMESPACE = previousNamespace;
    }
    expect(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: join(directory, 'checkout'),
        encoding: 'utf8',
      }).trim(),
    ).toMatch(/^[0-9a-f]{40,64}$/);
  });

  describe('pull', () => {
    const file = (path: string, contents: string) => ({
      path,
      contentsBase64: Buffer.from(contents).toString('base64'),
      executable: false,
    });
    const version2 = (files: ReturnType<typeof file>[]) => ({
      ...snapshot,
      baseVersionId: 'version_2',
      files: [
        ...snapshot.files.filter(
          (current) => !files.some((next) => next.path === current.path),
        ),
        ...files,
      ],
    });
    const git = (checkout: string, ...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Agent',
          '-c',
          'user.email=agent@example.test',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          ...args,
        ],
        { cwd: checkout, encoding: 'utf8' },
      ).trim();
    const manifest = (checkout: string) =>
      JSON.parse(
        readFileSync(join(checkout, '.git/cavuno-builder.json'), 'utf8'),
      );
    const cli = (...args: string[]) =>
      createCliProgram('test')
        .exitOverride()
        .parseAsync(
          [
            'node',
            'cavuno',
            '--api-url',
            'https://example.test/api/v1',
            'builder',
            ...args,
            '--directory',
            join(directory, 'checkout'),
          ],
          { from: 'node' },
        );
    const serve = (value: unknown) =>
      vi
        .mocked(globalThis.fetch)
        .mockImplementation(async () => Response.json(value));
    const lastPrinted = () =>
      JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    /** Accept every submit as `versionId`; returns the request bodies sent. */
    const acceptSubmits = (versionId: string) => {
      const bodies: unknown[] = [];
      vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
        const path = String(url);
        bodies.push(init?.body);
        if (path.endsWith('/staged'))
          return Response.json(
            { operationId: 'operation_1', status: 'created' },
            { status: 201 },
          );
        if (path.endsWith('/payload')) return Response.json({});
        return Response.json({ kind: 'accepted', versionId });
      });
      return bodies;
    };
    const lines = (...values: string[]) => `${values.join('\n')}\n`;
    const original = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'];
    /**
     * Check out a draft holding src/lines.ts, commit the agent's first line as
     * `submitted` together with a file submit skips, and submit it.
     */
    const submitFirstLine = async (submitted: string) => {
      serve({
        ...snapshot,
        files: [...snapshot.files, file('src/lines.ts', lines(...original))],
      });
      await run();
      const checkout = join(directory, 'checkout');
      writeFileSync(join(checkout, '.env'), 'SECRET=local\n');
      writeFileSync(
        join(checkout, 'src/lines.ts'),
        lines(submitted, ...original.slice(1)),
      );
      git(checkout, 'add', '-A');
      git(checkout, 'commit', '-qm', 'agent edit');
      acceptSubmits('version_2');
      await cli('submit');
      return checkout;
    };
    const serveLines = (first: string, last: string) =>
      serve({
        ...snapshot,
        baseVersionId: 'version_3',
        files: [
          ...snapshot.files,
          file('src/lines.ts', lines(first, ...original.slice(1, -1), last)),
        ],
      });

    it('reports an unchanged draft as up to date', async () => {
      await run();
      serve(snapshot);
      await cli('pull');
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        'https://example.test/api/v1/builder/boards/board_1/drafts/draft_1/snapshot',
        expect.anything(),
      );
      expect(lastPrinted()).toMatchObject({
        baseVersionId: 'version_1',
        status: 'up_to_date',
      });
    });

    it('merges a newer version, keeps local commits, and advances the base', async () => {
      await run();
      const checkout = join(directory, 'checkout');
      writeFileSync(join(checkout, 'src/index.ts'), 'export const a = 1;\n');
      git(checkout, 'commit', '-qam', 'local edit');
      serve(
        version2([
          file('.gitignore', 'node_modules/\ndist/\n'),
          file('src/new.ts', 'export {};\n'),
        ]),
      );
      await cli('pull');
      expect(lastPrinted()).toMatchObject({
        baseVersionId: 'version_2',
        previousBaseVersionId: 'version_1',
        status: 'merged',
      });
      expect(readFileSync(join(checkout, 'src/index.ts'), 'utf8')).toBe(
        'export const a = 1;\n',
      );
      expect(readFileSync(join(checkout, '.gitignore'), 'utf8')).toBe(
        'node_modules/\ndist/\n',
      );
      expect(existsSync(join(checkout, 'src/new.ts'))).toBe(true);
      expect(git(checkout, 'status', '--porcelain')).toBe('');
      expect(manifest(checkout)).toEqual({
        boardId: 'board_1',
        draftId: 'draft_1',
        baseVersionId: 'version_2',
      });
    });

    it('leaves conflicts for the agent and submits the pulled base once committed', async () => {
      await run();
      const checkout = join(directory, 'checkout');
      writeFileSync(
        join(checkout, 'src/index.ts'),
        'export const local = 1;\n',
      );
      git(checkout, 'commit', '-qam', 'local edit');
      serve(version2([file('src/index.ts', 'export const live = 1;\n')]));
      await expect(cli('pull')).rejects.toThrow(
        /conflicts in:\nsrc\/index\.ts\n.*npx cavuno@latest builder submit/s,
      );
      expect(readFileSync(join(checkout, 'src/index.ts'), 'utf8')).toContain(
        '<<<<<<<',
      );
      expect(manifest(checkout)).toMatchObject({
        baseVersionId: 'version_1',
        pendingBaseVersionId: 'version_2',
      });
      await expect(cli('submit')).rejects.toThrow(/resolve the conflicts/);

      writeFileSync(
        join(checkout, 'src/index.ts'),
        'export const local = 1;\nexport const live = 1;\n',
      );
      git(checkout, 'commit', '-qam', 'resolve');
      const bodies = acceptSubmits('version_3');
      await cli('submit');
      expect(JSON.parse(String(bodies[0]))).toMatchObject({
        baseVersionId: 'version_2',
      });
      expect(manifest(checkout)).toEqual({
        boardId: 'board_1',
        draftId: 'draft_1',
        baseVersionId: 'version_3',
      });
      expect(git(checkout, 'rev-parse', 'refs/cavuno/base')).toBe(
        git(checkout, 'rev-parse', 'HEAD'),
      );
    });

    it('lets the agent abort a conflicted pull back to its own commit', async () => {
      await run();
      const checkout = join(directory, 'checkout');
      writeFileSync(
        join(checkout, 'src/index.ts'),
        'export const local = 1;\n',
      );
      git(checkout, 'commit', '-qam', 'local edit');
      const head = git(checkout, 'rev-parse', 'HEAD');
      serve(version2([file('src/index.ts', 'export const live = 1;\n')]));
      await expect(cli('pull')).rejects.toThrow(/conflicts in/);
      expect(git(checkout, 'rev-parse', 'MERGE_HEAD')).toBe(
        git(checkout, 'rev-parse', 'refs/cavuno/pending'),
      );
      git(checkout, 'merge', '--abort');
      expect(git(checkout, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(checkout, 'status', '--porcelain')).toBe('');
      expect(readFileSync(join(checkout, 'src/index.ts'), 'utf8')).toBe(
        'export const local = 1;\n',
      );
    });

    it('keeps committed files submit skips when pulling after an accepted submit', async () => {
      await run();
      const checkout = join(directory, 'checkout');
      writeFileSync(join(checkout, '.env'), 'SECRET=local\n');
      writeFileSync(join(checkout, 'src/index.ts'), 'export const a = 1;\n');
      git(checkout, 'add', '-A');
      git(checkout, 'commit', '-qm', 'local edit with env');
      acceptSubmits('version_2');
      await cli('submit');
      serve({
        ...snapshot,
        baseVersionId: 'version_3',
        files: [
          ...snapshot.files.filter((f) => f.path !== 'src/index.ts'),
          file('src/index.ts', 'export const a = 1;\n'),
          file('src/live.ts', 'export {};\n'),
        ],
      });
      await cli('pull');
      expect(lastPrinted()).toMatchObject({ status: 'merged' });
      expect(readFileSync(join(checkout, '.env'), 'utf8')).toBe(
        'SECRET=local\n',
      );
      expect(readFileSync(join(checkout, 'src/index.ts'), 'utf8')).toBe(
        'export const a = 1;\n',
      );
      expect(existsSync(join(checkout, 'src/live.ts'))).toBe(true);
      expect(git(checkout, 'status', '--porcelain')).toBe('');
    });

    it('merges from the submitted tree, keeping a server revert of a submitted line', async () => {
      const checkout = await submitFirstLine('X');
      serveLines('l1', 'SRV');
      await cli('pull');
      expect(lastPrinted()).toMatchObject({ status: 'merged' });
      expect(readFileSync(join(checkout, 'src/lines.ts'), 'utf8')).toBe(
        lines('l1', ...original.slice(1, -1), 'SRV'),
      );
      expect(readFileSync(join(checkout, '.env'), 'utf8')).toBe(
        'SECRET=local\n',
      );
      expect(git(checkout, 'status', '--porcelain')).toBe('');
      expect(git(checkout, 'rev-list', '--parents', '-n1', 'HEAD')).toBe(
        [
          git(checkout, 'rev-parse', 'HEAD'),
          git(checkout, 'rev-parse', 'HEAD^1'),
          git(checkout, 'rev-parse', 'refs/cavuno/base'),
        ].join(' '),
      );
    });

    it('takes a server edit of a submitted line without a conflict', async () => {
      const checkout = await submitFirstLine('X');
      serveLines('Y', 'l8');
      await cli('pull');
      expect(lastPrinted()).toMatchObject({ status: 'merged' });
      expect(readFileSync(join(checkout, 'src/lines.ts'), 'utf8')).toBe(
        lines('Y', ...original.slice(1)),
      );
      expect(git(checkout, 'status', '--porcelain')).toBe('');
    });

    it('refuses a working tree with uncommitted or untracked changes', async () => {
      await run();
      const checkout = join(directory, 'checkout');
      writeFileSync(join(checkout, 'notes.md'), 'draft\n');
      vi.mocked(globalThis.fetch).mockClear();
      await expect(cli('pull')).rejects.toThrow(/Commit or remove/);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(manifest(checkout).baseVersionId).toBe('version_1');
    });
  });

  it('refuses a nonempty destination before fetching', async () => {
    const checkout = join(directory, 'checkout');
    symlinkSync(directory, checkout);
    await expect(run()).rejects.toThrow(/destination/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects unsafe snapshot paths without writing outside the checkout', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      Response.json({
        ...snapshot,
        files: [
          { path: '../escaped', contentsBase64: 'YQ==', executable: false },
        ],
      }),
    );
    await expect(run()).rejects.toThrow(/path/i);
    expect(existsSync(join(directory, 'escaped'))).toBe(false);
  });

  it('rejects file/directory collisions before writing source', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      Response.json({
        ...snapshot,
        files: [
          { path: 'src', contentsBase64: 'YQ==', executable: false },
          { path: 'src/index.ts', contentsBase64: 'Yg==', executable: false },
        ],
      }),
    );
    await expect(run()).rejects.toThrow(/collision/i);
    expect(existsSync(join(directory, 'checkout'))).toBe(false);
  });

  it('requires the standard CAVUNO_API_KEY', async () => {
    delete process.env.CAVUNO_API_KEY;
    await expect(run()).rejects.toThrow(/CAVUNO_API_KEY/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
