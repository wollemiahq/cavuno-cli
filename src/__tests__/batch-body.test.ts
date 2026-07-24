import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readBatchBody } from '../lib/batch-body.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('readBatchBody', () => {
  let dir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cav-batch-'));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    errSpy.mockRestore();
  });

  it('parses a JSON body from a readable --file', async () => {
    const path = join(dir, 'ops.json');
    writeFileSync(path, '{"operations":[{"id":"a","method":"DELETE"}]}');
    await expect(readBatchBody(path)).resolves.toEqual({
      operations: [{ id: 'a', method: 'DELETE' }],
    });
  });

  // Regression: a missing --file must exit 2 with a clean message, never a
  // raw ENOENT stack trace + exit 10.
  it('exits 2 with a clean message when --file does not exist', async () => {
    const path = join(dir, 'missing.json');
    await expect(readBatchBody(path)).rejects.toThrow(
      'process.exit unexpectedly called with "2"',
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(`batch: could not read --file ${path}`),
    );
  });

  it('exits 2 when the --file body is not valid JSON', async () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, 'not json');
    await expect(readBatchBody(path)).rejects.toThrow(
      'process.exit unexpectedly called with "2"',
    );
    expect(errSpy).toHaveBeenCalledWith('batch: body is not valid JSON');
  });

  it('exits 2 when the --file body is empty', async () => {
    const path = join(dir, 'empty.json');
    writeFileSync(path, '   \n');
    await expect(readBatchBody(path)).rejects.toThrow(
      'process.exit unexpectedly called with "2"',
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('expected JSON body'),
    );
  });
});
