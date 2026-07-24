import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  mockCreate,
  mockUpdate,
  mockList,
  mockSearch,
  mockUploadLogo,
  mockDeleteLogo,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockList: vi.fn(),
  mockSearch: vi.fn(),
  mockUploadLogo: vi.fn(),
  mockDeleteLogo: vi.fn(),
}));

vi.mock('../api/companies.js', () => ({
  createCompaniesClient: vi.fn(() => ({
    create: mockCreate,
    update: mockUpdate,
    list: mockList,
    search: mockSearch,
    uploadLogo: mockUploadLogo,
    deleteLogo: mockDeleteLogo,
  })),
}));

import { registerCompaniesCommand } from '../commands/companies.js';

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
  registerCompaniesCommand(program);
  return program;
}

describe('companies CLI command registration', () => {
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

  it('exposes first-class company logo upload and delete commands', () => {
    const program = createProgram();
    const companies = program.commands.find((c) => c.name() === 'companies');
    expect(companies).toBeDefined();

    const subcommands = companies!.commands.map((c) => c.name()).sort();
    expect(subcommands).toContain('upload-logo');
    expect(subcommands).toContain('delete-logo');
  });

  it('uploads a company logo through the dedicated companies endpoint', async () => {
    const filePath = join(tmpdir(), `cavuno-cli-logo-${Date.now()}.png`);
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    mockUploadLogo.mockResolvedValue({
      data: { id: 'k18company', object: 'company', logoUrl: 'https://logo' },
      error: undefined,
      response: new Response(null, { status: 201 }),
    });

    try {
      await createProgram().parseAsync(
        ['node', 'cavuno', 'companies', 'upload-logo', 'k18company', filePath],
        { from: 'node' },
      );
    } finally {
      await unlink(filePath).catch(() => undefined);
    }

    expect(mockUploadLogo).toHaveBeenCalledOnce();
    expect(mockUploadLogo.mock.calls[0]![0]).toBe('k18company');
    expect(mockUploadLogo.mock.calls[0]![1]).toBeInstanceOf(FormData);
  });

  it('deletes a company logo through the dedicated companies endpoint', async () => {
    mockDeleteLogo.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'companies', 'delete-logo', 'k18company', '--yes'],
      { from: 'node' },
    );

    expect(mockDeleteLogo).toHaveBeenCalledWith('k18company');
  });

  it('refuses to delete a company logo without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'companies', 'delete-logo', 'k18company'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });

    expect(mockDeleteLogo).not.toHaveBeenCalled();
  });

  it('passes canonical markets on create and preserves an empty update as a clear', async () => {
    const ok = {
      data: { id: 'k18company' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
    mockCreate.mockResolvedValue(ok);
    mockUpdate.mockResolvedValue(ok);

    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'companies',
        'create',
        '--name',
        'Acme',
        '--markets',
        'fintech, saas',
      ],
      { from: 'node' },
    );
    await createProgram().parseAsync(
      ['node', 'cavuno', 'companies', 'update', 'k18company', '--markets', ''],
      { from: 'node' },
    );

    expect(mockCreate).toHaveBeenCalledWith({
      name: 'Acme',
      markets: ['fintech', 'saas'],
    });
    expect(mockUpdate).toHaveBeenCalledWith('k18company', { markets: [] });
  });

  it('uses the search endpoint for market-filtered search and list commands', async () => {
    mockSearch.mockResolvedValue({
      data: { data: [] },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'companies', 'search', '--markets', 'fintech,saas'],
      { from: 'node' },
    );
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'companies',
        'list',
        '--markets',
        'fintech',
        '--limit',
        '10',
      ],
      { from: 'node' },
    );

    expect(mockSearch).toHaveBeenNthCalledWith(1, {
      query: undefined,
      limit: undefined,
      filters: { markets: ['fintech', 'saas'] },
    });
    expect(mockSearch).toHaveBeenNthCalledWith(2, {
      query: undefined,
      cursor: undefined,
      limit: 10,
      filters: { markets: ['fintech'] },
    });
    expect(mockList).not.toHaveBeenCalled();
  });
});
