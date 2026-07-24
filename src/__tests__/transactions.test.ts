import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockGet } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('../api/transactions.js', () => ({
  createTransactionsClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
  })),
}));

import { registerTransactionsCommand } from '../commands/transactions.js';

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
  registerTransactionsCommand(program);
  return program;
}

describe('transactions CLI', () => {
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
    mockList.mockResolvedValue(
      success({
        object: 'list',
        url: '/v1/transactions',
        hasMore: false,
        nextCursor: null,
        sortedBy: 'date',
        data: [],
      }),
    );
    mockGet.mockResolvedValue(
      success({ id: 'tx_1', object: 'transaction', amountCents: 100 }),
    );
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
  });

  it('registers list and get under transactions', async () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('transactions');
    const tx = program.commands.find((c) => c.name() === 'transactions')!;
    expect(tx.commands.map((c) => c.name()).sort()).toEqual(['get', 'list']);
  });

  it('calls list with filters', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'transactions',
        'list',
        '--status',
        'paid',
        '--kind',
        'invoice',
        '--search',
        'Acme',
      ],
      { from: 'node' },
    );
    expect(mockList).toHaveBeenCalledWith({
      status: 'paid',
      kind: 'invoice',
      search: 'Acme',
    });
  });

  it('wires --order-id and --subscription-id to source-ref params', async () => {
    await createProgram().parseAsync(
      ['node', 'cavuno', 'transactions', 'list', '--order-id', 'jo_123'],
      { from: 'node' },
    );
    expect(mockList).toHaveBeenCalledWith({ orderId: 'jo_123' });

    mockList.mockClear();
    await createProgram().parseAsync(
      ['node', 'cavuno', 'transactions', 'list', '--subscription-id', 'es_456'],
      { from: 'node' },
    );
    expect(mockList).toHaveBeenCalledWith({ subscriptionId: 'es_456' });
  });

  it('calls get with id', async () => {
    await createProgram().parseAsync(
      ['node', 'cavuno', 'transactions', 'get', 'tx_abc'],
      { from: 'node' },
    );
    expect(mockGet).toHaveBeenCalledWith('tx_abc');
  });
});
