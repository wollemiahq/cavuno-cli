import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerBackfillCommand } from '../commands/backfill.js';

const listRules = vi.fn();
const getRule = vi.fn();
const createRule = vi.fn();
const updateRule = vi.fn();
const removeRule = vi.fn();
const listCompanies = vi.fn();
const startCompany = vi.fn();
const stopCompany = vi.fn();
const bulkStartCompanies = vi.fn();
const bulkStopCompanies = vi.fn();
const matchCompany = vi.fn();
const markNoMatch = vi.fn();
const getProgress = vi.fn();
const getSettings = vi.fn();
const updateSettings = vi.fn();
const unblockAllBlockedJobs = vi.fn();

vi.mock('../api/backfill.js', () => ({
  createBackfillClient: () => ({
    listRules,
    getRule,
    createRule,
    updateRule,
    removeRule,
    listCompanies,
    startCompany,
    stopCompany,
    bulkStartCompanies,
    bulkStopCompanies,
    matchCompany,
    markNoMatch,
    getProgress,
    getSettings,
    updateSettings,
    unblockAllBlockedJobs,
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
  registerBackfillCommand(program);
  return program;
}

const companyOk = {
  data: {
    object: 'backfill_company',
    companyId: 'co1',
    name: 'Acme',
    website: null,
    state: 'available',
  },
  error: undefined,
  response: new Response(),
};

beforeEach(() => {
  vi.clearAllMocks();
  listRules.mockResolvedValue({
    data: { object: 'list', data: [], hasMore: false, nextCursor: null },
    error: undefined,
    response: new Response(),
  });
  getRule.mockResolvedValue({
    data: { id: 'r1', object: 'backfill_rule', name: 'Engineering' },
    error: undefined,
    response: new Response(),
  });
  createRule.mockResolvedValue({
    data: { id: 'r1', object: 'backfill_rule', name: 'Engineering' },
    error: undefined,
    response: new Response(),
  });
  updateRule.mockResolvedValue({
    data: { id: 'r1', object: 'backfill_rule', name: 'Platform' },
    error: undefined,
    response: new Response(),
  });
  removeRule.mockResolvedValue({
    data: undefined,
    error: undefined,
    response: new Response(null, { status: 204 }),
  });
  listCompanies.mockResolvedValue({
    data: { object: 'list', data: [], hasMore: false, nextCursor: null },
    error: undefined,
    response: new Response(),
  });
  startCompany.mockResolvedValue(companyOk);
  stopCompany.mockResolvedValue(companyOk);
  getProgress.mockResolvedValue({
    data: {
      object: 'backfill_progress',
      status: 'enhancing',
      jobsMatched: 10,
      jobsToEnhance: 8,
      jobsEnhanced: 2,
      jobsFailed: 0,
    },
    error: undefined,
    response: new Response(),
  });
  bulkStartCompanies.mockResolvedValue({
    data: {
      object: 'backfill_bulk_result',
      data: [{ companyId: 'co1', status: 'ok' }],
    },
    error: undefined,
    response: new Response(),
  });
  bulkStopCompanies.mockResolvedValue({
    data: {
      object: 'backfill_bulk_result',
      data: [{ companyId: 'co1', status: 'ok' }],
    },
    error: undefined,
    response: new Response(),
  });
  matchCompany.mockResolvedValue(companyOk);
  markNoMatch.mockResolvedValue(companyOk);
  const settingsOk = {
    data: {
      object: 'backfill_settings',
      jobLimit: null,
      maxJobAgeDays: null,
      excludeWorldwideRemote: false,
      sponsoredJobsEnabled: false,
      sponsoredJobsConfigurable: true,
    },
    error: undefined,
    response: new Response(),
  };
  getSettings.mockResolvedValue(settingsOk);
  updateSettings.mockResolvedValue(settingsOk);
  unblockAllBlockedJobs.mockResolvedValue({
    data: {
      object: 'backfill_unblock_all',
      blockedBefore: 3,
      unblocked: 3,
      continuing: false,
    },
    error: undefined,
    response: new Response(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cavuno backfill rules', () => {
  it('lists rules', async () => {
    await buildProgram().parseAsync(['backfill', 'rules', 'list'], {
      from: 'user',
    });
    expect(listRules).toHaveBeenCalledOnce();
  });

  it('gets a rule', async () => {
    await buildProgram().parseAsync(['backfill', 'rules', 'get', 'r1'], {
      from: 'user',
    });
    expect(getRule).toHaveBeenCalledWith('r1');
  });

  it('creates a rule with JSON cards', async () => {
    const rules = JSON.stringify([
      {
        match: 'any',
        conditions: [
          { field: 'title', operator: 'contains_any', terms: ['engineer'] },
        ],
      },
    ]);
    await buildProgram().parseAsync(
      [
        'backfill',
        'rules',
        'create',
        '--name',
        'Engineering',
        '--rules',
        rules,
        '--idempotency-key',
        'k1',
      ],
      { from: 'user' },
    );
    expect(createRule).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Engineering' }),
      { idempotencyKey: 'k1' },
    );
  });

  it('removes a rule with --yes', async () => {
    await buildProgram().parseAsync(
      ['backfill', 'rules', 'remove', 'r1', '--yes', '--idempotency-key', 'k2'],
      { from: 'user' },
    );
    expect(removeRule).toHaveBeenCalledWith('r1', { idempotencyKey: 'k2' });
  });
});

describe('cavuno backfill companies', () => {
  it('lists companies by state', async () => {
    await buildProgram().parseAsync(
      ['backfill', 'companies', 'list', '--state', 'available'],
      { from: 'user' },
    );
    expect(listCompanies).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'available' }),
    );
  });

  it('starts and stops a company', async () => {
    await buildProgram().parseAsync(
      ['backfill', 'companies', 'start', 'co1', '--idempotency-key', 's1'],
      { from: 'user' },
    );
    await buildProgram().parseAsync(
      ['backfill', 'companies', 'stop', 'co1', '--idempotency-key', 's2'],
      { from: 'user' },
    );
    expect(startCompany).toHaveBeenCalledWith('co1', {
      idempotencyKey: 's1',
    });
    expect(stopCompany).toHaveBeenCalledWith('co1', {
      idempotencyKey: 's2',
    });
  });

  it('bulk-starts companies', async () => {
    await buildProgram().parseAsync(
      [
        'backfill',
        'companies',
        'bulk-start',
        '--company-ids',
        'co1,co2',
        '--idempotency-key',
        'b1',
      ],
      { from: 'user' },
    );
    expect(bulkStartCompanies).toHaveBeenCalledWith(
      { companyIds: ['co1', 'co2'] },
      { idempotencyKey: 'b1' },
    );
  });

  it('matches and marks no-match', async () => {
    await buildProgram().parseAsync(
      [
        'backfill',
        'companies',
        'match',
        'co1',
        '--candidate-index',
        '0',
        '--start',
        '--idempotency-key',
        'm1',
      ],
      { from: 'user' },
    );
    await buildProgram().parseAsync(
      [
        'backfill',
        'companies',
        'mark-no-match',
        'co1',
        '--idempotency-key',
        'm2',
      ],
      { from: 'user' },
    );
    expect(matchCompany).toHaveBeenCalledWith(
      'co1',
      { candidateIndex: 0, start: true },
      { idempotencyKey: 'm1' },
    );
    expect(markNoMatch).toHaveBeenCalledWith('co1', {
      idempotencyKey: 'm2',
    });
  });
});

describe('cavuno backfill progress', () => {
  it('reads aggregate progress', async () => {
    await buildProgram().parseAsync(['backfill', 'progress'], {
      from: 'user',
    });
    expect(getProgress).toHaveBeenCalledOnce();
  });
});

describe('cavuno backfill settings', () => {
  it('reads the settings', async () => {
    await buildProgram().parseAsync(['backfill', 'settings', 'get'], {
      from: 'user',
    });
    expect(getSettings).toHaveBeenCalledOnce();
  });

  it('sends only the flags given', async () => {
    await buildProgram().parseAsync(
      [
        'backfill',
        'settings',
        'update',
        '--job-limit',
        '2000',
        '--no-sponsored-jobs',
        '--idempotency-key',
        'u1',
      ],
      { from: 'user' },
    );
    expect(updateSettings).toHaveBeenCalledWith(
      { jobLimit: 2000, sponsoredJobsEnabled: false },
      { idempotencyKey: 'u1' },
    );
  });

  it('clears a number with an empty string and maps the switches', async () => {
    await buildProgram().parseAsync(
      [
        'backfill',
        'settings',
        'update',
        '--max-job-age-days',
        '',
        '--exclude-worldwide-remote',
        '--sponsored-jobs',
        '--idempotency-key',
        'u2',
      ],
      { from: 'user' },
    );
    expect(updateSettings).toHaveBeenCalledWith(
      {
        maxJobAgeDays: null,
        excludeWorldwideRemote: true,
        sponsoredJobsEnabled: true,
      },
      { idempotencyKey: 'u2' },
    );
  });

  it('exits 2 when no setting is given', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      buildProgram().parseAsync(['backfill', 'settings', 'update'], {
        from: 'user',
      }),
    ).rejects.toThrow('exit 2');
    expect(exit).toHaveBeenCalledWith(2);
    expect(updateSettings).not.toHaveBeenCalled();
  });
});

describe('cavuno backfill blocked-jobs', () => {
  it('unblocks all with --yes', async () => {
    await buildProgram().parseAsync(
      [
        'backfill',
        'blocked-jobs',
        'unblock-all',
        '--yes',
        '--idempotency-key',
        'b9',
      ],
      { from: 'user' },
    );
    expect(unblockAllBlockedJobs).toHaveBeenCalledWith({
      idempotencyKey: 'b9',
    });
  });
});
