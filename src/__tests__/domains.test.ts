import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockList, mockGet, mockAdd, mockVerify, mockRemove, mockOpsGet } =
  vi.hoisted(() => ({
    mockList: vi.fn(),
    mockGet: vi.fn(),
    mockAdd: vi.fn(),
    mockVerify: vi.fn(),
    mockRemove: vi.fn(),
    mockOpsGet: vi.fn(),
  }));

vi.mock('../api/domains.js', () => ({
  createDomainsClient: vi.fn(() => ({
    list: mockList,
    get: mockGet,
    add: mockAdd,
    verify: mockVerify,
    remove: mockRemove,
  })),
}));

vi.mock('../api/operations.js', () => ({
  createOperationsClient: vi.fn(() => ({ get: mockOpsGet })),
}));

vi.mock('../api/index.js', () => ({
  formatApiError: vi.fn(() => 'api error'),
}));

import { registerDomainsCommand } from '../commands/domains.js';

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
  registerDomainsCommand(program);
  return program;
}

describe('domains CLI command registration', () => {
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

  it('exposes add, list, get, verify, and remove commands', () => {
    const program = createProgram();
    const domains = program.commands.find((c) => c.name() === 'domains');
    expect(domains).toBeDefined();

    const subcommands = domains!.commands.map((c) => c.name()).sort();
    expect(subcommands).toEqual(['add', 'get', 'list', 'remove', 'verify']);
  });

  it('adds a domain through POST /v1/domains', async () => {
    mockAdd.mockResolvedValue({
      data: { id: 'domain_123', object: 'domain' },
      error: undefined,
      response: new Response(null, { status: 201 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'domains', 'add', 'jobs.example.com'],
      { from: 'node' },
    );

    expect(mockAdd).toHaveBeenCalledWith({ domain: 'jobs.example.com' });
  });

  it('starts verification through POST /v1/domains/:id/verify', async () => {
    mockVerify.mockResolvedValue({
      data: { id: 'op_123', object: 'operation', kind: 'domains.verify' },
      error: undefined,
      response: new Response(null, { status: 202 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'domains', 'verify', 'domain_123'],
      { from: 'node' },
    );

    expect(mockVerify).toHaveBeenCalledWith('domain_123');
  });

  it('removes a domain through DELETE /v1/domains/:id when --yes bypasses the prompt', async () => {
    mockRemove.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'domains', 'remove', 'domain_123', '--yes'],
      { from: 'node' },
    );

    expect(mockRemove).toHaveBeenCalledWith('domain_123');
  });

  it('refuses to remove a domain without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'domains', 'remove', 'domain_123'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('verify --wait polls the operation and prints the terminal envelope', async () => {
    mockVerify.mockResolvedValue({
      data: { id: 'op_123', object: 'operation', kind: 'domains.verify' },
      error: undefined,
      response: new Response(null, { status: 202 }),
    });
    mockOpsGet.mockResolvedValue({
      data: { id: 'op_123', object: 'operation', state: 'succeeded' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'domains', 'verify', 'domain_123', '--wait'],
      { from: 'node' },
    );

    expect(mockOpsGet).toHaveBeenCalledWith('op_123');
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        { id: 'op_123', object: 'operation', state: 'succeeded' },
        null,
        2,
      ),
    );
  });

  it('maps domains_not_found to the standard not-found exit code', async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { error: { code: 'domains_not_found' } },
      response: new Response(null, { status: 404 }),
    });

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'domains', 'get', 'domain_missing'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 4 });
  });

  it('rejects non-numeric list limits before calling the API', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'domains', 'list', '--limit', 'abc'],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');

    expect(mockList).not.toHaveBeenCalled();
  });

  it('rejects out-of-range list limits before calling the API', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'domains', 'list', '--limit', '0'],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'domains', 'list', '--limit', '51'],
        { from: 'node' },
      ),
    ).rejects.toThrow('process.exit unexpectedly called with "2"');

    expect(mockList).not.toHaveBeenCalled();
  });
});
