import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  mockList,
  mockGet,
  mockCount,
  mockAlerts,
  mockUnsubscribe,
  mockResubscribe,
  mockExport,
  mockImport,
  mockOpGet,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockCount: vi.fn(),
  mockAlerts: vi.fn(),
  mockUnsubscribe: vi.fn(),
  mockResubscribe: vi.fn(),
  mockExport: vi.fn(),
  mockImport: vi.fn(),
  mockOpGet: vi.fn(),
}));

vi.mock('../api/subscribers.js', () => ({
  createSubscribersClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    count: mockCount,
    alerts: mockAlerts,
    unsubscribe: mockUnsubscribe,
    resubscribe: mockResubscribe,
    export: mockExport,
    import: mockImport,
  })),
}));

vi.mock('../api/operations.js', () => ({
  createOperationsClient: vi.fn(() => ({ get: mockOpGet })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerSubscribersCommand } from '../commands/subscribers.js';

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
  registerSubscribersCommand(program);
  return program;
}

const ok = (data: unknown, status = 200) => ({
  data,
  error: undefined,
  response: new Response(null, { status }),
});

describe('subscribers CLI command registration', () => {
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

  it('exposes the subscriber subcommands', () => {
    const program = createProgram();
    const subscribers = program.commands.find(
      (c) => c.name() === 'subscribers',
    );
    expect(subscribers).toBeDefined();

    const subcommands = subscribers!.commands.map((c) => c.name()).sort();
    expect(subcommands).toEqual([
      'alerts',
      'count',
      'export',
      'get',
      'import',
      'list',
      'resubscribe',
      'unsubscribe',
    ]);
  });

  it('lists subscribers with status/search filters through GET /v1/subscribers', async () => {
    mockList.mockResolvedValue(ok({ data: [] }));

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'subscribers',
        'list',
        '--status',
        'confirmed',
        '--search',
        'alice',
        '--limit',
        '10',
      ],
      { from: 'node' },
    );

    expect(mockList).toHaveBeenCalledWith({
      status: 'confirmed',
      search: 'alice',
      limit: 10,
    });
  });

  it('counts confirmed subscribers through GET /v1/subscribers/count', async () => {
    mockCount.mockResolvedValue(
      ok({ object: 'subscriber_count', confirmed: 42 }),
    );

    await createProgram().parseAsync(
      ['node', 'cavuno', 'subscribers', 'count'],
      { from: 'node' },
    );

    expect(mockCount).toHaveBeenCalledTimes(1);
  });

  it('lists a subscriber alerts through GET /v1/subscribers/:id/alerts', async () => {
    mockAlerts.mockResolvedValue(ok({ data: [] }));

    await createProgram().parseAsync(
      ['node', 'cavuno', 'subscribers', 'alerts', 'sub_123'],
      { from: 'node' },
    );

    expect(mockAlerts).toHaveBeenCalledWith('sub_123');
  });

  it('unsubscribes with an idempotency key', async () => {
    mockUnsubscribe.mockResolvedValue(ok({ id: 'sub_123' }));

    await createProgram().parseAsync(
      ['node', 'cavuno', 'subscribers', 'unsubscribe', 'sub_123'],
      { from: 'node' },
    );

    expect(mockUnsubscribe).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('resubscribes through POST /v1/subscribers/:id/resubscribe', async () => {
    mockResubscribe.mockResolvedValue(ok({ id: 'sub_123' }));

    await createProgram().parseAsync(
      ['node', 'cavuno', 'subscribers', 'resubscribe', 'sub_123'],
      { from: 'node' },
    );

    expect(mockResubscribe).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('defaults export to csv (async operation)', async () => {
    mockExport.mockResolvedValue(
      ok({ id: 'op_1', object: 'operation', state: 'pending' }, 202),
    );

    await createProgram().parseAsync(
      ['node', 'cavuno', 'subscribers', 'export'],
      { from: 'node' },
    );

    expect(mockExport).toHaveBeenCalledWith({ format: 'csv' });
    expect(mockOpGet).not.toHaveBeenCalled();
  });

  it('prints the inline list for --export-format json', async () => {
    mockExport.mockResolvedValue(
      ok({ object: 'list', data: [{ id: 'sub_1' }] }),
    );

    await createProgram().parseAsync(
      ['node', 'cavuno', 'subscribers', 'export', '--export-format', 'json'],
      { from: 'node' },
    );

    expect(mockExport).toHaveBeenCalledWith({ format: 'json' });
    expect(mockOpGet).not.toHaveBeenCalled();
  });

  it('polls the export operation to terminal when --wait is set', async () => {
    mockExport.mockResolvedValue(
      ok({ id: 'op_export', object: 'operation', state: 'pending' }, 202),
    );
    mockOpGet.mockResolvedValue(
      ok({
        id: 'op_export',
        object: 'operation',
        state: 'succeeded',
        result: { downloadUrl: 'https://files/export.csv', rowCount: 5 },
      }),
    );

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'subscribers',
        'export',
        '--export-format',
        'csv',
        '--wait',
      ],
      { from: 'node' },
    );

    expect(mockOpGet).toHaveBeenCalledWith('op_export');
  });

  it('rejects an invalid --export-format before calling the API', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'subscribers', 'export', '--export-format', 'xml'],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');

    expect(mockExport).not.toHaveBeenCalled();
  });

  it('maps the over-cap json export 413 to exit code 2', async () => {
    mockExport.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'subscribers_export_too_large' } },
      response: new Response(null, { status: 413 }),
    });

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'subscribers', 'export', '--export-format', 'json'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  it('imports a CSV file and polls the operation with --wait', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subscribers-'));
    const file = join(dir, 'subscribers.csv');
    writeFileSync(file, 'email\nalice@example.com\n');

    mockImport.mockResolvedValue(
      ok({ id: 'op_import', object: 'operation', state: 'pending' }, 202),
    );
    mockOpGet.mockResolvedValue(
      ok({
        id: 'op_import',
        object: 'operation',
        state: 'succeeded',
        result: { totalRows: 1, created: 1 },
      }),
    );

    await createProgram().parseAsync(
      ['node', 'cavuno', 'subscribers', 'import', file, '--wait'],
      { from: 'node' },
    );

    expect(mockImport).toHaveBeenCalledTimes(1);
    const [importArg, idempotencyArg] = mockImport.mock.calls[0]!;
    expect(importArg).toMatchObject({
      sendConfirmation: true,
      fileName: 'subscribers.csv',
    });
    expect((importArg as { file: Blob }).file).toBeInstanceOf(Blob);
    expect(idempotencyArg).toMatchObject({
      idempotencyKey: expect.any(String),
    });
    expect(mockOpGet).toHaveBeenCalledWith('op_import');
  });

  it('passes --no-send-confirmation through to the import call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subscribers-'));
    const file = join(dir, 'subscribers.csv');
    writeFileSync(file, 'email\nalice@example.com\n');

    mockImport.mockResolvedValue(
      ok({ id: 'op_import', object: 'operation', state: 'pending' }, 202),
    );

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'subscribers',
        'import',
        file,
        '--no-send-confirmation',
      ],
      { from: 'node' },
    );

    const [importArg] = mockImport.mock.calls[0]!;
    expect(importArg).toMatchObject({ sendConfirmation: false });
  });

  it('maps subscribers_not_found to the standard not-found exit code', async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'subscribers_not_found' } },
      response: new Response(null, { status: 404 }),
    });

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'subscribers', 'get', 'sub_missing'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 4 });
  });

  it('maps subscribers_already_unsubscribed to the state-conflict exit code', async () => {
    mockUnsubscribe.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'subscribers_already_unsubscribed' } },
      response: new Response(null, { status: 409 }),
    });

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'subscribers', 'unsubscribe', 'sub_123'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 7 });
  });

  it('rejects non-numeric list limits before calling the API', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'subscribers', 'list', '--limit', 'abc'],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');

    expect(mockList).not.toHaveBeenCalled();
  });
});
