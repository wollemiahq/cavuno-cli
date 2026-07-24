import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerUsageCommand } from '../commands/jobs.js';

const getUsage = vi.fn();

vi.mock('../api/usage.js', () => ({
  createUsageClient: () => ({
    get: getUsage,
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
  registerUsageCommand(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUsage.mockResolvedValue({
    data: {
      object: 'usage',
      capacities: [
        {
          key: 'active_jobs',
          used: 47,
          limit: 100,
          remaining: 53,
        },
        {
          key: 'confirmed_subscribers',
          used: 420,
          limit: 1000,
          remaining: 580,
        },
        {
          key: 'team_seats',
          used: 3,
          limit: 5,
          remaining: 2,
        },
      ],
    },
    error: undefined,
    response: new Response(),
  });
});

describe('cavuno usage', () => {
  it('get maps to GET /v1/usage and prints capacities', async () => {
    const program = buildProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program.parseAsync(['usage', 'get'], { from: 'user' });
    expect(getUsage).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('active_jobs');
    expect(printed).toContain('confirmed_subscribers');
    expect(printed).toContain('team_seats');
    logSpy.mockRestore();
  });
});
