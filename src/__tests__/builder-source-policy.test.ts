import { describe, expect, it } from 'vitest';

import { isSafeBuilderConfig } from '../commands/builder-source-policy.js';
import { packageBuilderSource } from '../commands/builder-submit.js';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Builder public configuration policy', () => {
  it.each([
    ['.npmrc', 'min-release-age=1440\n'],
    ['.dev.vars.example', "CAVUNO_API_URL='http://localhost:3000/v1'\n"],
    ['.dev.vars.example', 'CAVUNO_API_URL=http://127.0.0.1:3000/v1\n'],
    ['.dev.vars.example', 'CAVUNO_BOARD=pk_example\nCAVUNO_DEV_TOOLS=0\n'],
  ])('accepts %s (%s)', (path, contents) => {
    expect(isSafeBuilderConfig(path, Buffer.from(contents))).toBe(true);
  });

  it.each([
    ['.npmrc', 'registry=https://example.com'],
    ['.npmrc', 'MIN-RELEASE-AGE=0'],
    ['.npmrc', 'min-release-age=${AGE}'],
    ['.npmrc', '# empty'],
    ['.dev.vars.example', '# empty'],
    ['.dev.vars.example', 'CAVUNO_API_URL=http://example.com'],
    ['.dev.vars.example', 'CAVUNO_API_URL=http://127.1'],
    ['.dev.vars.example', 'CAVUNO_API_URL=https://example.com/#'],
    ['.dev.vars.example', 'CAVUNO_DEV_TOOLS=yes'],
    ['.dev.vars.example', 'CAVUNO_BOARD="pk_example\''],
    ['.dev.vars.example', 'CAVUNO_BOARD=pk_example\u0000'],
    ['.dev.vars.example', 'CAVUNO_BOARD=pk_example\rSECRET=secret'],
  ])('refuses unsafe config during packaging %s (%s)', (path, contents) => {
    const directory = mkdtempSync(join(tmpdir(), 'builder-policy-'));
    try {
      writeFileSync(join(directory, path), contents);
      expect(() => packageBuilderSource(directory)).toThrow(/Unsafe Builder/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(['.npmrc', '.dev.vars.example'])(
    'rejects oversized and invalid UTF-8 %s',
    (path) => {
      expect(isSafeBuilderConfig(path, Buffer.alloc(4097, 35))).toBe(false);
      expect(isSafeBuilderConfig(path, Buffer.from([0xff]))).toBe(false);
    },
  );
});
