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
});
