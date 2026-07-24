import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CliError, resolveAuth } from '../lib/auth.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('resolveAuth', () => {
  let original: { key?: string; url?: string };
  beforeEach(() => {
    original = {
      key: process.env.CAVUNO_API_KEY,
      url: process.env.CAVUNO_API_URL,
    };
    delete process.env.CAVUNO_API_KEY;
    delete process.env.CAVUNO_API_URL;
  });
  afterEach(() => {
    if (original.key !== undefined) process.env.CAVUNO_API_KEY = original.key;
    else delete process.env.CAVUNO_API_KEY;
    if (original.url !== undefined) process.env.CAVUNO_API_URL = original.url;
    else delete process.env.CAVUNO_API_URL;
  });

  it('throws CliError exit=1 when CAVUNO_API_KEY is missing', () => {
    try {
      resolveAuth();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(1);
      expect((err as CliError).message).toMatch(/CAVUNO_API_KEY/);
    }
  });

  it('throws CliError when key is malformed', () => {
    process.env.CAVUNO_API_KEY = 'not-a-real-key';
    try {
      resolveAuth();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(1);
      expect((err as CliError).message).toMatch(/cavuno_live_/);
    }
  });

  it('returns key + default URL when valid', () => {
    process.env.CAVUNO_API_KEY = VALID_KEY;
    const auth = resolveAuth();
    expect(auth.apiKey).toBe(VALID_KEY);
    expect(auth.baseUrl).toBe('https://api.cavuno.com/v1');
  });

  it('honors CAVUNO_API_URL env var', () => {
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'https://api.example.com/v1';
    const auth = resolveAuth();
    expect(auth.baseUrl).toBe('https://api.example.com/v1');
  });

  it('--api-url flag overrides env', () => {
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'https://env.example.com/v1';
    const auth = resolveAuth({ apiUrl: 'https://flag.example.com/v1' });
    expect(auth.baseUrl).toBe('https://flag.example.com/v1');
  });
});
