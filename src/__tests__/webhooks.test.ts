import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockList,
  mockCreate,
  mockGet,
  mockUpdate,
  mockDelete,
  mockRotate,
  mockTest,
  mockDeliveriesList,
  mockDeliveriesGet,
  mockDeliveriesReplay,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockRotate: vi.fn(),
  mockTest: vi.fn(),
  mockDeliveriesList: vi.fn(),
  mockDeliveriesGet: vi.fn(),
  mockDeliveriesReplay: vi.fn(),
}));

vi.mock('../api/webhooks.js', () => ({
  createWebhooksClient: vi.fn(() => ({
    listWebhookEndpoints: mockList,
    createWebhookEndpoint: mockCreate,
    getWebhookEndpoint: mockGet,
    updateWebhookEndpoint: mockUpdate,
    deleteWebhookEndpoint: mockDelete,
    rotateWebhookEndpointSecret: mockRotate,
    testWebhookEndpoint: mockTest,
    deliveries: {
      list: mockDeliveriesList,
      get: mockDeliveriesGet,
      replay: mockDeliveriesReplay,
    },
  })),
  verifyWebhook: vi.fn(),
}));
vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerWebhooksCommand } from '../commands/webhooks.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
  registerWebhooksCommand(program);
  return program;
}

describe('webhooks CLI command registration', () => {
  let originalKey: string | undefined;
  let originalUrl: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    originalUrl = process.env.CAVUNO_API_URL;
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'http://localhost:3000/api/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('exposes endpoints + deliveries groups and no grant', () => {
    const program = createProgram();
    const webhooks = program.commands.find((c) => c.name() === 'webhooks');
    expect(webhooks).toBeDefined();

    const groups = webhooks!.commands.map((c) => c.name()).sort();
    expect(groups).toEqual(['deliveries', 'endpoints']);

    const endpoints = webhooks!.commands.find((c) => c.name() === 'endpoints');
    const subcommands = endpoints!.commands.map((c) => c.name()).sort();
    expect(subcommands).toEqual([
      'create',
      'delete',
      'get',
      'list',
      'rotate-secret',
      'test',
      'update',
    ]);
    expect(subcommands).not.toContain('grant');
    expect(webhooks!.commands.map((c) => c.name())).not.toContain('grant');

    const deliveries = webhooks!.commands.find(
      (c) => c.name() === 'deliveries',
    );
    expect(deliveries).toBeDefined();
    const deliveryCmds = deliveries!.commands.map((c) => c.name()).sort();
    expect(deliveryCmds).toEqual(['get', 'list', 'replay']);
  });

  it('lists endpoints through GET /v1/webhook-endpoints', async () => {
    mockList.mockResolvedValue({
      data: { object: 'list', data: [] },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'webhooks', 'endpoints', 'list', '--limit', '10'],
      { from: 'node' },
    );

    expect(mockList).toHaveBeenCalledWith({ limit: 10 });
  });

  it('creates an endpoint with idempotency and prints a store-now notice', async () => {
    mockCreate.mockResolvedValue({
      data: {
        id: 'whe_1',
        object: 'webhook_endpoint',
        secret: 'whsec_once',
      },
      error: undefined,
      response: new Response(null, { status: 201 }),
    });

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'webhooks',
        'endpoints',
        'create',
        '--url',
        'https://hooks.example.com/x',
        '--event-types',
        'job.created,job.updated',
      ],
      { from: 'node' },
    );

    expect(mockCreate).toHaveBeenCalledWith(
      {
        url: 'https://hooks.example.com/x',
        event_types: ['job.created', 'job.updated'],
      },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(
      errSpy.mock.calls.some((call) =>
        String(call[0]).includes('Store this signing secret now'),
      ),
    ).toBe(true);
  });

  it('deletes with --yes and refuses without confirmation when non-interactive', async () => {
    mockDelete.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'webhooks', 'endpoints', 'delete', 'whe_1', '--yes'],
      { from: 'node' },
    );
    expect(mockDelete).toHaveBeenCalledWith(
      'whe_1',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );

    mockDelete.mockClear();
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'webhooks', 'endpoints', 'delete', 'whe_1'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('requires --yes for rotate-secret and test in non-interactive mode', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'webhooks', 'endpoints', 'rotate-secret', 'whe_1'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mockRotate).not.toHaveBeenCalled();

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'webhooks', 'endpoints', 'test', 'whe_1'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mockTest).not.toHaveBeenCalled();
  });

  it('rotates secret and tests with confirmation bypass', async () => {
    mockRotate.mockResolvedValue({
      data: { id: 'whe_1', secret: 'whsec_new' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    mockTest.mockResolvedValue({
      data: {
        object: 'webhook_test_delivery',
        delivered: true,
        status: 200,
        status_class: 'success',
        latency_ms: 12,
        diagnostic: 'ok',
      },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'webhooks',
        'endpoints',
        'rotate-secret',
        'whe_1',
        '--yes',
      ],
      { from: 'node' },
    );
    expect(mockRotate).toHaveBeenCalledWith(
      'whe_1',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );

    await createProgram().parseAsync(
      ['node', 'cavuno', 'webhooks', 'endpoints', 'test', 'whe_1', '--yes'],
      { from: 'node' },
    );
    expect(mockTest).toHaveBeenCalledWith(
      'whe_1',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('updates status via PATCH', async () => {
    mockUpdate.mockResolvedValue({
      data: { id: 'whe_1', status: 'paused' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'webhooks',
        'endpoints',
        'update',
        'whe_1',
        '--status',
        'paused',
      ],
      { from: 'node' },
    );

    expect(mockUpdate).toHaveBeenCalledWith(
      'whe_1',
      { status: 'paused' },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('lists deliveries with endpoint/status filters', async () => {
    mockDeliveriesList.mockResolvedValue({
      data: { object: 'list', data: [] },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'webhooks',
        'deliveries',
        'list',
        '--endpoint',
        'whe_1',
        '--status',
        'delivered',
        '--limit',
        '10',
      ],
      { from: 'node' },
    );

    expect(mockDeliveriesList).toHaveBeenCalledWith({
      endpoint_id: 'whe_1',
      status: 'delivered',
      limit: 10,
    });
  });

  it('gets a delivery by id', async () => {
    mockDeliveriesGet.mockResolvedValue({
      data: {
        id: 'wdl_1',
        object: 'webhook_delivery',
        status: 'delivered',
        attempts: [],
      },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'webhooks', 'deliveries', 'get', 'wdl_1'],
      { from: 'node' },
    );

    expect(mockDeliveriesGet).toHaveBeenCalledWith('wdl_1');
  });

  it('replays with --yes and idempotency; refuses without confirmation', async () => {
    mockDeliveriesReplay.mockResolvedValue({
      data: { id: 'wdl_1', status: 'pending' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'webhooks', 'deliveries', 'replay', 'wdl_1', '--yes'],
      { from: 'node' },
    );
    expect(mockDeliveriesReplay).toHaveBeenCalledWith(
      'wdl_1',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );

    mockDeliveriesReplay.mockClear();
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'webhooks', 'deliveries', 'replay', 'wdl_1'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mockDeliveriesReplay).not.toHaveBeenCalled();
  });

  it('surfaces 409 open-delivery error with conflict exit code on replay', async () => {
    const { CliError } = await import('../lib/auth.js');
    const { fromApiError } = await import('../lib/error.js');

    // Real formatter path (not the suite-wide mock) — proves 409 maps to
    // webhooks_delivery_open → exit 7 (conflict family).
    const err = fromApiError(
      {
        error: {
          code: 'webhooks_delivery_open',
          message:
            'Cannot replay an open delivery; wait for the current attempt to complete',
        },
      },
      new Response(null, { status: 409 }),
    );
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(7);

    // Permanently dead destination is the same conflict exit family.
    const unreplayable = fromApiError(
      {
        error: {
          code: 'webhooks_delivery_unreplayable',
          message:
            'Delivery destination no longer exists; it cannot be replayed',
        },
      },
      new Response(null, { status: 409 }),
    );
    expect(unreplayable).toBeInstanceOf(CliError);
    expect(unreplayable.exitCode).toBe(7);

    mockDeliveriesReplay.mockResolvedValue({
      data: undefined,
      error: {
        error: {
          code: 'webhooks_delivery_open',
          message:
            'Cannot replay an open delivery; wait for the current attempt to complete',
        },
      },
      response: new Response(null, { status: 409 }),
    });

    await expect(
      createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'webhooks',
          'deliveries',
          'replay',
          'wdl_open',
          '--yes',
        ],
        { from: 'node' },
      ),
    ).rejects.toBeInstanceOf(CliError);
  });
});
