import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSubscription, mockGetConnect, mockPostConnectOnboardingLink } =
  vi.hoisted(() => ({
    mockGetSubscription: vi.fn(),
    mockGetConnect: vi.fn(),
    mockPostConnectOnboardingLink: vi.fn(),
  }));

vi.mock('../api/billing.js', () => ({
  createBillingClient: vi.fn(() => ({
    getSubscription: mockGetSubscription,
    getConnect: mockGetConnect,
    postConnectOnboardingLink: mockPostConnectOnboardingLink,
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
    mockPostConnectOnboardingLink.mockResolvedValue(
      success({
        object: 'billing_connect_onboarding_link',
        url: 'https://connect.stripe.com/setup/s/abc',
        expiresAt: '2024-01-01T00:05:00.000Z',
      }),
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

  it('calls postConnectOnboardingLink for billing connect-link and prints the URL', async () => {
    await createProgram().parseAsync(
      ['node', 'cavuno', 'billing', 'connect-link'],
      { from: 'node' },
    );
    expect(mockPostConnectOnboardingLink).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.flat().join('\n')).toContain(
      'https://connect.stripe.com/setup/s/abc',
    );
  });
});
