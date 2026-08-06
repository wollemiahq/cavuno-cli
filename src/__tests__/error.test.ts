import { describe, expect, it } from 'vitest';

import { fromApiError } from '../lib/error.js';

function fakeResponse(status: number, headers: Record<string, string> = {}) {
  return { status, headers: new Headers(headers) };
}

describe('fromApiError', () => {
  it('maps jobs_not_found → exit 4', () => {
    const err = fromApiError(
      { error: { code: 'jobs_not_found', message: 'Job not found' } },
      fakeResponse(404),
    );
    expect(err.exitCode).toBe(4);
    expect(err.message).toContain('jobs_not_found');
    expect(err.message).toContain('Job not found');
  });

  it('maps marketing_permissions_not_found → exit 4', () => {
    const err = fromApiError(
      {
        error: {
          code: 'marketing_permissions_not_found',
          message: 'Marketing permission resource not found',
        },
      },
      fakeResponse(404),
    );
    expect(err.exitCode).toBe(4);
  });

  it('maps jobs_quota_exceeded → exit 5', () => {
    const err = fromApiError(
      { error: { code: 'jobs_quota_exceeded', message: 'Limit reached' } },
      fakeResponse(409),
    );
    expect(err.exitCode).toBe(5);
  });

  it('maps validation_bad_request → exit 2 + prints issue paths', () => {
    const err = fromApiError(
      {
        error: {
          code: 'validation_bad_request',
          message: 'failed',
          details: {
            issues: [
              { path: ['title'], message: 'Required' },
              { path: ['filters', 'placeIds'], message: 'Too many values' },
            ],
          },
        },
      },
      fakeResponse(400),
    );
    expect(err.exitCode).toBe(2);
    expect(err.message).toContain('title: Required');
    expect(err.message).toContain('filters.placeIds: Too many values');
  });

  it('includes Retry-After on 429', () => {
    const err = fromApiError(
      { error: { code: 'rate_limited', message: 'Slow down' } },
      fakeResponse(429, { 'retry-after': '30' }),
    );
    expect(err.exitCode).toBe(6);
    expect(err.message).toContain('retry-after: 30s');
  });

  it('falls back to exit 10 for unknown codes', () => {
    const err = fromApiError(
      { error: { code: 'totally_unknown', message: 'huh' } },
      fakeResponse(500),
    );
    expect(err.exitCode).toBe(10);
  });

  it('handles missing error envelope', () => {
    const err = fromApiError({}, fakeResponse(500));
    expect(err.exitCode).toBe(10);
    expect(err.message).toContain('http_500');
  });

  it('includes requestId when present', () => {
    const err = fromApiError(
      {
        error: {
          code: 'jobs_not_found',
          message: 'gone',
          requestId: 'req_abc123',
        },
      },
      fakeResponse(404),
    );
    expect(err.message).toContain('req_abc123');
  });
});
