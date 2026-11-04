import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUpdate,
  mockGet,
  mockDeleteHero,
  mockClearPasswordProtection,
  mockSetJobFormCustomFields,
  mockUpdateAdsense,
  mockStartJobFormCustomFieldAiFill,
  mockListProfileFieldDefinitions,
  mockReplaceProfileFieldDefinitions,
  mockStartProfileFieldAiFill,
} = vi.hoisted(() => ({
  mockStartJobFormCustomFieldAiFill: vi.fn(),
  mockListProfileFieldDefinitions: vi.fn(),
  mockReplaceProfileFieldDefinitions: vi.fn(),
  mockStartProfileFieldAiFill: vi.fn(),
  mockUpdateAdsense: vi.fn(),
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
    updateAdsense: mockUpdateAdsense,
    setPasswordProtection: vi.fn(),
    clearPasswordProtection: mockClearPasswordProtection,
    setJobFormCustomFields: mockSetJobFormCustomFields,
    startJobFormCustomFieldAiFill: mockStartJobFormCustomFieldAiFill,
    listProfileFieldDefinitions: mockListProfileFieldDefinitions,
    replaceProfileFieldDefinitions: mockReplaceProfileFieldDefinitions,
    startProfileFieldAiFill: mockStartProfileFieldAiFill,
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

  it('forwards analytics tracking ID flags, with "" clearing an ID', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'update',
        '--ga4-measurement-id',
        'G-ABC123XYZ',
        '--linkedin-conversion-apply-submit-id',
        '44444444',
        '--meta-pixel-id',
        '',
      ],
      { from: 'node' },
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0]).toEqual({
      ga4MeasurementId: 'G-ABC123XYZ',
      linkedinConversionApplySubmitId: '44444444',
      metaPixelId: '',
    });
  });

  it('forwards update-adsense --google-consent-message as a boolean', async () => {
    mockUpdateAdsense.mockResolvedValue(
      success({ object: 'settings_adsense' }),
    );
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'update-adsense',
        '--google-consent-message',
        'false',
      ],
      { from: 'node' },
    );

    expect(mockUpdateAdsense).toHaveBeenCalledTimes(1);
    expect(mockUpdateAdsense.mock.calls[0]![0]).toEqual({
      adsenseGoogleConsentMessage: false,
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

describe('settings AI fill and profile field commands', () => {
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
    const run = {
      runId: 'run_1',
      status: 'queued',
      fieldKeys: ['visa_sponsorship'],
    };
    mockStartJobFormCustomFieldAiFill.mockResolvedValue(success(run));
    mockStartProfileFieldAiFill.mockResolvedValue(success(run));
    mockListProfileFieldDefinitions.mockResolvedValue(success({ data: [] }));
    mockReplaceProfileFieldDefinitions.mockResolvedValue(success({ data: [] }));
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
  });

  it('job-form-ai-fill splits --fields into fieldKeys', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'job-form-ai-fill',
        '--fields',
        'visa_sponsorship, clearance',
      ],
      { from: 'node' },
    );

    expect(mockStartJobFormCustomFieldAiFill).toHaveBeenCalledWith({
      fieldKeys: ['visa_sponsorship', 'clearance'],
    });
  });

  it('profile-fields-ai-fill defaults to the company entity', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'profile-fields-ai-fill',
        '--fields',
        'industry',
      ],
      { from: 'node' },
    );

    expect(mockStartProfileFieldAiFill).toHaveBeenCalledWith('company', {
      fieldKeys: ['industry'],
    });
  });

  it('maps 409 settings_ai_fill_running to exit 7', async () => {
    mockStartJobFormCustomFieldAiFill.mockResolvedValue({
      data: undefined,
      error: {
        error: {
          code: 'settings_ai_fill_running',
          message: 'A run is already going.',
        },
      },
      response: new Response(null, { status: 409 }),
    });

    await expect(
      createProgram().parseAsync(
        ['node', 'cavuno', 'settings', 'job-form-ai-fill', '--fields', 'a'],
        { from: 'node' },
      ),
    ).rejects.toMatchObject({ exitCode: 7 });
  });

  it('rejects a non-company entity and empty --fields with exit 2', async () => {
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit:${code}`);
    }) as never);

    try {
      await expect(
        createProgram().parseAsync(
          [
            'node',
            'cavuno',
            'settings',
            'profile-fields-ai-fill',
            '--entity',
            'candidate',
            '--fields',
            'a',
          ],
          { from: 'node' },
        ),
      ).rejects.toThrow('exit:2');
      await expect(
        createProgram().parseAsync(
          ['node', 'cavuno', 'settings', 'job-form-ai-fill', '--fields', ','],
          { from: 'node' },
        ),
      ).rejects.toThrow('exit:2');
      expect(mockStartProfileFieldAiFill).not.toHaveBeenCalled();
      expect(mockStartJobFormCustomFieldAiFill).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('profile-fields-list passes --entity through', async () => {
    await createProgram().parseAsync(
      [
        'node',
        'cavuno',
        'settings',
        'profile-fields-list',
        '--entity',
        'candidate',
      ],
      { from: 'node' },
    );

    expect(mockListProfileFieldDefinitions).toHaveBeenCalledWith('candidate');
  });

  it('profile-fields-set accepts the bare array profile-fields-list prints', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'cavuno-profile-fields-'));
    const filePath = join(dir, 'fields.json');
    const definitions = [
      { key: 'industry', label: 'Industry', type: 'short_text' },
    ];
    await writeFile(filePath, JSON.stringify(definitions), 'utf8');

    try {
      await createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'settings',
          'profile-fields-set',
          '--entity',
          'company',
          '--file',
          filePath,
        ],
        { from: 'node' },
      );

      expect(mockReplaceProfileFieldDefinitions).toHaveBeenCalledWith(
        'company',
        { definitions },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('profile-fields-set forwards the --file body for the entity', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = await mkdtemp(join(tmpdir(), 'cavuno-profile-fields-'));
    const filePath = join(dir, 'fields.json');
    const body = {
      definitions: [
        {
          key: 'industry',
          label: 'Industry',
          type: 'short_text',
          aiFill: true,
        },
      ],
    };
    await writeFile(filePath, JSON.stringify(body), 'utf8');

    try {
      await createProgram().parseAsync(
        [
          'node',
          'cavuno',
          'settings',
          'profile-fields-set',
          '--entity',
          'company',
          '--file',
          filePath,
        ],
        { from: 'node' },
      );

      expect(mockReplaceProfileFieldDefinitions).toHaveBeenCalledWith(
        'company',
        body,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
