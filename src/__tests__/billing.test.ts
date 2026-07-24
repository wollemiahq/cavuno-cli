import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSubscription, mockGetConnect } = vi.hoisted(() => ({
  mockGetSubscription: vi.fn(),
  mockGetConnect: vi.fn(),
}));

vi.mock('../api/billing.js', () => ({
  createBillingClient: vi.fn(() => ({
    getSubscription: mockGetSubscription,
    getConnect: mockGetConnect,
  })),
}));

import { registerBillingCommand } from '../commands/billing.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function success(data: unknown = {}) {
  return {
    data,
    error: undefined,
    response: new Response(null, { status: 200 }),
  };
}

function createProgram() {
  const program = new Command();
  program
    .exitOverride()
    .option('--api-url <url>')
    .option('--format <format>', 'Output format', 'json');
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerBillingCommand(program);
  return program;
}

describe('billing CLI read commands', () => {
  let originalKey: string | undefined;
  let originalUrl: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    originalUrl = process.env.CAVUNO_API_URL;
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'http://localhost:3000/api/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.clearAllMocks();
    mockGetSubscription.mockResolvedValue(
      success({ object: 'billing_subscription', active: false }),
    );
    mockGetConnect.mockResolvedValue(
      success({ object: 'billing_connect', connected: false }),
    );
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
  });

  it('calls getSubscription for billing subscription', async () => {
    await createProgram().parseAsync(
      ['node', 'cavuno', 'billing', 'subscription'],
      { from: 'node' },
    );
    expect(mockGetSubscription).toHaveBeenCalledTimes(1);
  });

  it('calls getConnect for billing connect', async () => {
    await createProgram().parseAsync(['node', 'cavuno', 'billing', 'connect'], {
      from: 'node',
    });
    expect(mockGetConnect).toHaveBeenCalledTimes(1);
  });
});
