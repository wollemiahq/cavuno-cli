import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  emails: vi.fn(),
  activity: vi.fn(),
  jobAlerts: vi.fn(),
  jobAlert: vi.fn(),
  subscription: vi.fn(),
  unsubscribe: vi.fn(),
  resubscribe: vi.fn(),
  removeSubscription: vi.fn(),
  removeJobAlert: vi.fn(),
}));

vi.mock('../api/contacts.js', () => ({
  createContactsClient: vi.fn(() => client),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerContactsCommand } from '../commands/contacts.js';

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
  registerContactsCommand(program);
  return program;
}

const ok = (data: unknown, status = 200) => ({
  data,
  error: undefined,
  response: new Response(null, { status }),
});

const runCli = (...args: string[]) =>
  createProgram().parseAsync(['node', 'cavuno', 'contacts', ...args], {
    from: 'node',
  });

describe('cavuno contacts', () => {
  let originalKey: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_KEY = `cavuno_live_${'a'.repeat(16)}_${'A'.repeat(32)}`;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    logSpy.mockRestore();
  });

  it('passes only the filters given to GET /v1/contacts', async () => {
    client.list.mockResolvedValue(ok({ data: [] }));

    await runCli(
      'list',
      '--status',
      'suppressed',
      '--subscription',
      'marketing',
      '--limit',
      '20',
    );

    expect(client.list).toHaveBeenCalledWith({
      status: 'suppressed',
      subscription: 'marketing',
      limit: 20,
    });
  });

  it('prints the contact it reads', async () => {
    client.get.mockResolvedValue(ok({ id: 'c1', status: 'subscribed' }));

    await runCli('get', 'c1');

    expect(client.get).toHaveBeenCalledWith('c1');
    expect(logSpy.mock.calls.join('\n')).toContain('"status": "subscribed"');
  });

  const idem = () =>
    expect.objectContaining({ idempotencyKey: expect.any(String) });

  it.each([
    [['get', 'c1'], 'get', () => ['c1']],
    [['emails', 'c1'], 'emails', () => ['c1']],
    [['activity', 'c1'], 'activity', () => ['c1']],
    [['job-alerts', 'c1'], 'jobAlerts', () => ['c1']],
    [['job-alert', 'c1', 'a1'], 'jobAlert', () => ['c1', 'a1']],
    [
      ['subscription', 'c1', 'marketing'],
      'subscription',
      () => ['c1', 'marketing'],
    ],
    [['unsubscribe', 'c1', '--yes'], 'unsubscribe', () => ['c1', idem()]],
    [['resubscribe', 'c1', '--yes'], 'resubscribe', () => ['c1', idem()]],
    [
      ['remove-subscription', 'c1', 'job_matches', '--yes'],
      'removeSubscription',
      () => ['c1', 'job_matches', idem()],
    ],
    [
      ['remove-job-alert', 'c1', 'a1', '--yes'],
      'removeJobAlert',
      () => ['c1', 'a1', idem()],
    ],
  ] as const)(
    '%j calls %s with its arguments in order',
    async (argv, method, args) => {
      const fn = client[method];
      fn.mockResolvedValue(ok({ data: [] }));

      await runCli(...argv);

      expect(fn).toHaveBeenCalledWith(...args());
      for (const [name, other] of Object.entries(client)) {
        if (name !== method) expect(other).not.toHaveBeenCalled();
      }
    },
  );

  it('refuses a write without --yes when not interactive, and calls nothing', async () => {
    await expect(runCli('unsubscribe', 'c1')).rejects.toThrow('--yes');
    await expect(
      runCli('remove-subscription', 'c1', 'marketing'),
    ).rejects.toThrow('--yes');
    await expect(runCli('remove-job-alert', 'c1', 'a1')).rejects.toThrow(
      '--yes',
    );
    await expect(runCli('resubscribe', 'c1')).rejects.toThrow('--yes');

    expect(client.unsubscribe).not.toHaveBeenCalled();
    expect(client.removeSubscription).not.toHaveBeenCalled();
    expect(client.removeJobAlert).not.toHaveBeenCalled();
    expect(client.resubscribe).not.toHaveBeenCalled();
  });

  it('removes one subscription with --yes and prints nothing for the 204', async () => {
    client.removeSubscription.mockResolvedValue(ok(undefined, 204));

    await runCli('remove-subscription', 'c1', 'job_matches', '--yes');

    expect(client.removeSubscription).toHaveBeenCalledWith(
      'c1',
      'job_matches',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('surfaces an API refusal as an error', async () => {
    client.resubscribe.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'not_resubscribable', message: 'No.' } },
      response: new Response(null, { status: 409 }),
    });

    await expect(runCli('resubscribe', 'c1', '--yes')).rejects.toThrow();
  });
});
