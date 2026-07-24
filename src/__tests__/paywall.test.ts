import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPaywallCommand } from '../commands/paywall.js';

const get = vi.fn();
const replace = vi.fn();
const listSubscriptions = vi.fn();

vi.mock('../api/paywall.js', () => ({
  createPaywallClient: () => ({
    get,
    replace,
    listSubscriptions,
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
  registerPaywallCommand(program);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({
    data: { object: 'candidate_paywall', offers: [] },
    error: undefined,
    response: new Response(),
  });
  replace.mockResolvedValue({
    data: { object: 'candidate_paywall', offers: [] },
    error: undefined,
    response: new Response(),
  });
  listSubscriptions.mockResolvedValue({
    data: { object: 'list', data: [] },
    error: undefined,
    response: new Response(),
  });
});

describe('cavuno paywall', () => {
  it('get maps to get()', async () => {
    const program = buildProgram();
    await program.parseAsync(['paywall', 'get'], { from: 'user' });
    expect(get).toHaveBeenCalled();
  });

  it('replace maps to replace() with body + idempotency key', async () => {
    const program = buildProgram();
    const body = JSON.stringify({
      enabled: false,
      previewCount: 5,
      lockHeading: 'Subscribe',
      lockDescription: '',
      buttonText: 'Unlock',
      disclaimerText: '',
      currency: 'usd',
      perMonthLabel: 'per month',
      savingsTemplate: '',
      offers: [],
    });
    await program.parseAsync(
      [
        'paywall',
        'replace',
        '--body',
        body,
        '--idempotency-key',
        'idem-paywall',
      ],
      { from: 'user' },
    );
    expect(replace).toHaveBeenCalledWith(JSON.parse(body), {
      idempotencyKey: 'idem-paywall',
    });
  });

  it('subscriptions maps filters to listSubscriptions()', async () => {
    const program = buildProgram();
    await program.parseAsync(
      [
        'paywall',
        'subscriptions',
        '--status',
        'active',
        '--kind',
        'lifetime',
        '--limit',
        '5',
      ],
      { from: 'user' },
    );
    expect(listSubscriptions).toHaveBeenCalledWith({
      status: 'active',
      kind: 'lifetime',
      limit: 5,
      cursor: undefined,
    });
  });
});
