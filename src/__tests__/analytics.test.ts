import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAnalyticsCommand } from '../commands/analytics.js';

const getOverview = vi.fn();
const getTraffic = vi.fn();

vi.mock('../api/analytics.js', () => ({
  createAnalyticsClient: () => ({
    getOverview,
    getTraffic,
  }),
}));

vi.mock('../lib/auth.js', () => ({
  resolveAuth: () => ({
    apiKey: 'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    baseUrl: 'http://localhost:3000/api/v1',
  }),
}));

function buildProgram() {
  const program = new Command();
  program.exitOverride();
  registerAnalyticsCommand(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  getOverview.mockResolvedValue({
    data: {
      object: 'analytics_overview',
      range: { start: '2026-01-01', end: '2026-01-30' },
      metrics: [],
    },
    error: undefined,
    response: new Response(),
  });
  getTraffic.mockResolvedValue({
    data: {
      object: 'analytics_traffic',
      range: { start: '2026-01-01', end: '2026-01-30' },
      pages: [],
      sources: [],
      locations: [],
      devices: [],
    },
    error: undefined,
    response: new Response(),
  });
});

describe('cavuno analytics', () => {
  it('overview maps to getOverview with date flags', async () => {
    const program = buildProgram();
    await program.parseAsync(
      ['analytics', 'overview', '--start', '2026-01-01', '--end', '2026-01-30'],
      { from: 'user' },
    );
    expect(getOverview).toHaveBeenCalledWith({
      start: '2026-01-01',
      end: '2026-01-30',
    });
  });

  it('traffic maps to getTraffic with limit', async () => {
    const program = buildProgram();
    await program.parseAsync(
      [
        'analytics',
        'traffic',
        '--start',
        '2026-01-01',
        '--end',
        '2026-01-07',
        '--limit',
        '5',
      ],
      { from: 'user' },
    );
    expect(getTraffic).toHaveBeenCalledWith({
      start: '2026-01-01',
      end: '2026-01-07',
      limit: 5,
    });
  });
});
