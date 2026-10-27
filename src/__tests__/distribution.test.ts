import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  listFeeds: vi.fn(),
  getFeed: vi.fn(),
  createFeed: vi.fn(),
  updateFeed: vi.fn(),
  removeFeed: vi.fn(),
  getFeedOrigin: vi.fn(),
  acknowledgeFeedOrigin: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('../api/distribution.js', () => ({
  createDistributionClient: vi.fn(() => client),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerDistributionCommand } from '../commands/distribution.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function ok(data: unknown, status = 200) {
  return { data, error: undefined, response: new Response(null, { status }) };
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
  registerDistributionCommand(program);
  return program;
}

function run(...args: string[]) {
  return createProgram().parseAsync(
    ['node', 'cavuno', 'distribution', ...args],
    {
      from: 'node',
    },
  );
}

describe('distribution CLI command registration', () => {
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
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
  });

  it('exposes feeds, origin and settings groups', () => {
    const distribution = createProgram().commands.find(
      (c) => c.name() === 'distribution',
    )!;
    const names = (name: string) =>
      distribution.commands
        .find((c) => c.name() === name)!
        .commands.map((c) => c.name())
        .sort();
    expect(names('feeds')).toEqual([
      'create',
      'get',
      'list',
      'remove',
      'update',
    ]);
    expect(names('origin')).toEqual(['acknowledge', 'get']);
    expect(names('settings')).toEqual(['get', 'update']);
  });

  it('creates a feed with a parsed filter', async () => {
    client.createFeed.mockResolvedValue(ok({ id: 'feed_1' }, 201));
    await run(
      'feeds',
      'create',
      'Remote jobs',
      '--template',
      'jooble',
      '--filter',
      '{"remoteOptions":["remote"]}',
    );
    expect(client.createFeed).toHaveBeenCalledWith(
      {
        name: 'Remote jobs',
        template: 'jooble',
        filter: { remoteOptions: ['remote'] },
      },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('updates only the options passed, with null and clear flags', async () => {
    client.updateFeed.mockResolvedValue(ok({ id: 'feed_1' }));
    await run(
      'feeds',
      'update',
      'feed_1',
      '--filter',
      'null',
      '--clear-contact-email',
    );
    expect(client.updateFeed).toHaveBeenCalledWith(
      'feed_1',
      { filter: null, contactEmail: null },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('rejects an unknown template before calling the API', async () => {
    await expect(
      run('feeds', 'create', 'X', '--template', 'monster'),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');
    expect(client.createFeed).not.toHaveBeenCalled();
  });

  it('removes a feed only with --yes when non-interactive', async () => {
    await expect(run('feeds', 'remove', 'feed_1')).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(client.removeFeed).not.toHaveBeenCalled();

    client.removeFeed.mockResolvedValue(ok(undefined, 204));
    await run('feeds', 'remove', 'feed_1', '--yes');
    expect(client.removeFeed).toHaveBeenCalledWith(
      'feed_1',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('maps distribution_feed_prebuilt to the conflict exit code', async () => {
    client.removeFeed.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'distribution_feed_prebuilt' } },
      response: new Response(null, { status: 409 }),
    });
    await expect(
      run('feeds', 'remove', 'feed_1', '--yes'),
    ).rejects.toMatchObject({ exitCode: 7 });
  });

  it('acknowledges the origin and switches Cavuno distribution off', async () => {
    client.acknowledgeFeedOrigin.mockResolvedValue(ok({ changed: false }));
    client.updateSettings.mockResolvedValue(
      ok({ cavunoDistributionEnabled: false }),
    );
    await run('origin', 'acknowledge');
    await run('settings', 'update', '--cavuno-distribution', 'off');
    expect(client.acknowledgeFeedOrigin).toHaveBeenCalledTimes(1);
    expect(client.updateSettings).toHaveBeenCalledWith(
      { cavunoDistributionEnabled: false },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });
});
