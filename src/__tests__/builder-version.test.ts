import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCliProgram } from '../program.js';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = `cavuno_live_${'a'.repeat(16)}_${'s'.repeat(32)}`;

describe('builder version CLI', () => {
  let directory: string;
  let previousKey: string | undefined;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cavuno-cli-version-'));
    mkdirSync(join(directory, '.git'));
    writeFileSync(
      join(directory, '.git', 'cavuno-builder.json'),
      JSON.stringify({
        boardId: 'board_1',
        draftId: 'draft_1',
        baseVersionId: 'version_2',
      }),
    );
    previousKey = process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_KEY = KEY;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ object: 'builder_status', state: 'verified' }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = previousKey;
  });

  async function run(action: 'status' | 'preview' | 'publish') {
    await createCliProgram('test')
      .exitOverride()
      .parseAsync(
        [
          'node',
          'cavuno',
          '--api-url',
          'https://example.test/api/v1',
          'builder',
          action,
          '--directory',
          directory,
        ],
        { from: 'node' },
      );
  }

  it.each(['status', 'preview', 'publish'] as const)(
    'uses the checked-out exact version for %s',
    async (action) => {
      await run(action);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://example.test/api/v1/builder/boards/board_1/drafts/draft_1/versions/version_2/${action}`,
        {
          method: action === 'publish' ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${KEY}` },
        },
      );
    },
  );

  it('reports a refused publish without implying it went live', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      Response.json(
        { error: { message: 'Builder publish access unavailable' } },
        { status: 403 },
      ),
    );
    await expect(run('publish')).rejects.toThrow(/publish failed \(403\)/);
  });

  it('does not send a request without an API key', async () => {
    delete process.env.CAVUNO_API_KEY;
    await expect(run('preview')).rejects.toThrow(/CAVUNO_API_KEY/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends the standard API key', async () => {
    await run('status');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/status'),
      expect.objectContaining({
        headers: { Authorization: `Bearer ${KEY}` },
      }),
    );
  });

  it('tells a retired Builder key holder how to migrate', async () => {
    delete process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_BUILDER_KEY = `cavuno_builder_${'a'.repeat(64)}`;
    try {
      await expect(run('status')).rejects.toThrow(
        /Builder keys are retired.*builder\.publish.*CAVUNO_API_KEY/,
      );
    } finally {
      delete process.env.CAVUNO_BUILDER_KEY;
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  describe('status --wait', () => {
    const status = (
      candidate: string,
      exposure: Record<string, unknown> | null,
      failedSummary: string | null = null,
    ) =>
      Response.json({
        object: 'builder_submission_status',
        candidate: { state: candidate, failedSummary },
        publicExposure: exposure,
      });

    async function wait(...extra: string[]) {
      await createCliProgram('test')
        .exitOverride()
        .parseAsync(
          [
            'node',
            'cavuno',
            '--api-url',
            'https://example.test/api/v1',
            'builder',
            'status',
            '--directory',
            directory,
            '--wait',
            '--interval-ms',
            '1000',
            ...extra,
          ],
          { from: 'node' },
        );
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('polls until the version is verified and cleared, then exits 0', async () => {
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(status('saved', null))
        .mockResolvedValueOnce(
          status('verified', {
            state: 'held',
            reason: 'Required check flagged or inconclusive',
            checks: {
              build: 'pass',
              dependencies: 'unknown',
              cookies: 'unknown',
              publicFiles: 'unknown',
            },
          }),
        )
        .mockResolvedValueOnce(
          status('verified', {
            state: 'cleared',
            reason: 'All required checks passed',
            checks: { build: 'pass' },
          }),
        );
      const done = wait();
      await vi.advanceTimersByTimeAsync(2000);
      await done;
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    it('keeps polling through a 503 while Cavuno deploys', async () => {
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response('Service Unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
          }),
        )
        .mockResolvedValueOnce(
          status('verified', {
            state: 'cleared',
            reason: 'All required checks passed',
            checks: { build: 'pass' },
          }),
        );
      const done = wait();
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('exits 11 like any timeout when a 503 lasts past it', async () => {
      vi.mocked(globalThis.fetch).mockImplementation(
        async () =>
          new Response('Service Unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
          }),
      );
      const done = expect(wait('--timeout-ms', '2500')).rejects.toMatchObject({
        exitCode: 11,
      });
      await vi.advanceTimersByTimeAsync(4000);
      await done;
    });

    it('exits 7 with the reason when checks fail or are flagged', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        status('failed', null, 'Build failed: src/app.ts'),
      );
      await expect(wait()).rejects.toMatchObject({
        message: 'Candidate checks failed: Build failed: src/app.ts',
        exitCode: 7,
      });
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        status('verified', {
          state: 'held',
          reason: 'Flagged version requires Cavuno review',
          checks: { build: 'pass', publicFiles: 'flagged' },
        }),
      );
      await expect(wait()).rejects.toMatchObject({
        message:
          'Version flagged by publicFiles: Flagged version requires Cavuno review',
        exitCode: 7,
      });
    });

    it('exits 0 when staff cleared a flagged version', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        status('verified', {
          state: 'cleared',
          reason: 'Cleared by Cavuno review',
          checks: { build: 'pass', publicFiles: 'flagged' },
        }),
      );
      await wait();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('reports the hold reason when an inconclusive hold outlasts --timeout-ms', async () => {
      vi.mocked(globalThis.fetch).mockImplementation(async () =>
        status('verified', {
          state: 'held',
          reason: 'Required check flagged or inconclusive',
          checks: { build: 'pass', publicFiles: 'unknown' },
        }),
      );
      const done = expect(wait('--timeout-ms', '2500')).rejects.toMatchObject({
        message:
          'Version still held after 2500ms: Required check flagged or inconclusive',
        exitCode: 11,
      });
      await vi.advanceTimersByTimeAsync(5000);
      await done;
    });

    it('exits 11 when the checks outlast --timeout-ms', async () => {
      vi.mocked(globalThis.fetch).mockImplementation(async () =>
        status('saved', null),
      );
      const done = expect(wait('--timeout-ms', '2500')).rejects.toMatchObject({
        exitCode: 11,
      });
      await vi.advanceTimersByTimeAsync(5000);
      await done;
    });
  });
});
