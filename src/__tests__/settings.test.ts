import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUpdate,
  mockGet,
  mockDeleteHero,
  mockClearPasswordProtection,
  mockSetJobFormCustomFields,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockGet: vi.fn(),
  mockDeleteHero: vi.fn(),
  mockClearPasswordProtection: vi.fn(),
  mockSetJobFormCustomFields: vi.fn(),
}));

vi.mock('../api/settings.js', () => ({
  createSettingsClient: vi.fn(() => ({
    update: mockUpdate,
    get: mockGet,
    getAdsense: vi.fn(),
    deleteHero: mockDeleteHero,
    updateAdsense: vi.fn(),
    setPasswordProtection: vi.fn(),
    clearPasswordProtection: mockClearPasswordProtection,
    setJobFormCustomFields: mockSetJobFormCustomFields,
  })),
}));

import { registerSettingsCommand } from '../commands/settings.js';

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
  registerSettingsCommand(program);
  return program;
}

describe('settings update CLI options', () => {
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
    mockUpdate.mockResolvedValue(success({ object: 'settings' }));
    mockGet.mockResolvedValue(success({ object: 'settings' }));
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
  });

  it('forwards require-cookie-consent and talent-directory-visibility', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'update',
        '--require-cookie-consent',
        'true',
        '--talent-directory-visibility',
        'employers_only',
      ],
      { from: 'node' },
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0]).toEqual({
      requireCookieConsent: true,
      talentDirectoryVisibility: 'employers_only',
    });
  });

  it('forwards recommendation feature flags', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'update',
        '--job-recommendations-enabled',
        'false',
        '--recommended-talent-enabled',
        'true',
      ],
      { from: 'node' },
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0]).toEqual({
      jobRecommendationsEnabled: false,
      recommendedTalentEnabled: true,
    });
  });

  it('forwards cookie banner label flags', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'update',
        '--cookie-banner-title',
        'We use cookies',
        '--cookie-banner-description',
        'For analytics',
        '--cookie-banner-reject-label',
        'Reject',
        '--cookie-banner-accept-label',
        'Accept',
        '--cookie-banner-manage-label',
        'Manage',
      ],
      { from: 'node' },
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0]).toEqual({
      cookieBannerTitle: 'We use cookies',
      cookieBannerDescription: 'For analytics',
      cookieBannerRejectLabel: 'Reject',
      cookieBannerAcceptLabel: 'Accept',
      cookieBannerManageLabel: 'Manage',
    });
  });

  it('forwards legacy talent-directory-enabled shorthand', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'update',
        '--talent-directory-enabled',
        'false',
      ],
      { from: 'node' },
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0]).toEqual({
      talentDirectoryEnabled: false,
    });
  });

  //every DELETE-route command confirms before calling the API;
  // --yes bypasses. Non-interactive without --yes must abort with exit 2.
  it('refuses delete-hero without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'settings', 'delete-hero'],
        {
          from: 'node',
        },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });

    expect(mockDeleteHero).not.toHaveBeenCalled();
  });

  it('deletes the hero through DELETE when --yes bypasses the prompt', async () => {
    mockDeleteHero.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'settings', 'delete-hero', '--yes'],
      { from: 'node' },
    );

    expect(mockDeleteHero).toHaveBeenCalledTimes(1);
  });

  it('refuses delete-password-protection without --yes when non-interactive (exit 2)', async () => {
    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'settings', 'delete-password-protection'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });

    expect(mockClearPasswordProtection).not.toHaveBeenCalled();
  });

  it('disables password protection when --yes bypasses the prompt', async () => {
    mockClearPasswordProtection.mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    });

    await createProgram().parseAsync(
      ['node', 'cavuno', 'settings', 'delete-password-protection', '--yes'],
      { from: 'node' },
    );

    expect(mockClearPasswordProtection).toHaveBeenCalledTimes(1);
  });

  it('forwards job-form-set-custom-fields --file body to setJobFormCustomFields', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'cavuno-custom-fields-'));
    const filePath = join(dir, 'fields.json');
    const body = {
      customFields: [
        {
          key: 'clearance',
          label: 'Clearance',
          type: 'short_text',
          required: false,
        },
      ],
    };
    await writeFile(filePath, JSON.stringify(body), 'utf8');

    mockSetJobFormCustomFields.mockResolvedValue(
      success({ customFields: body.customFields }),
    );

    try {
      await createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'settings',
          'job-form-set-custom-fields',
          '--file',
          filePath,
        ],
        { from: 'node' },
      );

      expect(mockSetJobFormCustomFields).toHaveBeenCalledTimes(1);
      expect(mockSetJobFormCustomFields.mock.calls[0]![0]).toEqual(body);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a null/non-object body with a clean exit 2, not a TypeError', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'cavuno-custom-fields-null-'));
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit:${code}`);
    }) as never);

    try {
      for (const raw of ['null', '[]', '{"customFields":"nope"}']) {
        const filePath = join(dir, 'bad.json');
        await writeFile(filePath, raw, 'utf8');
        await expect(
          createProgram().parseAsync(
            [
              'node',
              'cavuno',
              'settings',
              'job-form-set-custom-fields',
              '--file',
              filePath,
            ],
            { from: 'node' },
          ),
        ).rejects.toThrow('exit:2');
        expect(mockSetJobFormCustomFields).not.toHaveBeenCalled();
      }
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
