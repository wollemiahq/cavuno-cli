import { Command } from 'commander';

import { createSettingsClient } from '../api/settings.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import { readJsonBodyFromFileOrStdin } from '../lib/json-body.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createSettingsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
}

export function registerSettingsCommand(root: Command): void {
  const settings = root
    .command('settings')
    .description('Manage singleton board settings.');

  settings
    .command('get')
    .description('Fetch the singleton board settings.')
    .action(async function (this: Command) {
      const client = getClient(this);
      const format = getFormat(this);
      const { data, error, response } = await client.get();
      if (error) throw fromApiError(error, response);
      print(data, format);
    });

  settings
    .command('update')
    .description('Update fields on the singleton board settings.')
    .option('--name <name>', 'Board name')
    .option('--slug <slug>', 'Board slug (cascades to account slug)')
    .option('--blog-enabled <bool>', 'Toggle blog feature flag (true/false)')
    .option(
      '--candidates-enabled <bool>',
      'Toggle candidate-area flag (true/false)',
    )
    .option(
      '--country-gating-mode <mode>',
      'Apply country gating: sponsored_only | all_jobs',
    )
    .option(
      '--require-cookie-consent <bool>',
      'Toggle cookie consent banner (true/false)',
    )
    .option(
      '--talent-directory-visibility <mode>',
      'Talent directory mode: off | public | employers_only',
    )
    .option(
      '--talent-directory-enabled <bool>',
      'Legacy shorthand for talent directory (true→public, false→off)',
    )
    .option('--cookie-banner-title <text>', 'Cookie banner title')
    .option('--cookie-banner-description <text>', 'Cookie banner description')
    .option(
      '--cookie-banner-reject-label <text>',
      'Cookie banner reject button label',
    )
    .option(
      '--cookie-banner-accept-label <text>',
      'Cookie banner accept button label',
    )
    .option(
      '--cookie-banner-manage-label <text>',
      'Cookie banner manage/preferences label',
    )
    .action(async function (this: Command) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<Record<string, string | undefined>>();
      const body: Record<string, unknown> = {};
      if (opts.name) body.name = opts.name;
      if (opts.slug) body.slug = opts.slug;
      if (opts.blogEnabled !== undefined)
        body.blogEnabled = opts.blogEnabled === 'true';
      if (opts.candidatesEnabled !== undefined)
        body.candidatesEnabled = opts.candidatesEnabled === 'true';
      if (opts.countryGatingMode !== undefined) {
        const mode = opts.countryGatingMode;
        if (mode !== 'sponsored_only' && mode !== 'all_jobs') {
          console.error(
            '--country-gating-mode must be sponsored_only or all_jobs.',
          );
          process.exit(2);
        }
        body.countryGatingMode = mode;
      }
      if (opts.requireCookieConsent !== undefined)
        body.requireCookieConsent = opts.requireCookieConsent === 'true';
      if (opts.talentDirectoryVisibility !== undefined) {
        const mode = opts.talentDirectoryVisibility;
        if (mode !== 'off' && mode !== 'public' && mode !== 'employers_only') {
          console.error(
            '--talent-directory-visibility must be off, public, or employers_only.',
          );
          process.exit(2);
        }
        body.talentDirectoryVisibility = mode;
      }
      if (opts.talentDirectoryEnabled !== undefined)
        body.talentDirectoryEnabled = opts.talentDirectoryEnabled === 'true';
      if (opts.cookieBannerTitle !== undefined)
        body.cookieBannerTitle = opts.cookieBannerTitle;
      if (opts.cookieBannerDescription !== undefined)
        body.cookieBannerDescription = opts.cookieBannerDescription;
      if (opts.cookieBannerRejectLabel !== undefined)
        body.cookieBannerRejectLabel = opts.cookieBannerRejectLabel;
      if (opts.cookieBannerAcceptLabel !== undefined)
        body.cookieBannerAcceptLabel = opts.cookieBannerAcceptLabel;
      if (opts.cookieBannerManageLabel !== undefined)
        body.cookieBannerManageLabel = opts.cookieBannerManageLabel;
      if (Object.keys(body).length === 0) {
        console.error('No fields to update — pass at least one --flag.');
        process.exit(2);
      }
      const { data, error, response } = await client.update(
        body as Parameters<typeof client.update>[0],
      );
      if (error) throw fromApiError(error, response);
      print(data, format);
    });

  settings
    .command('get-adsense')
    .description('Fetch the AdSense configuration.')
    .action(async function (this: Command) {
      const client = getClient(this);
      const format = getFormat(this);
      const { data, error, response } = await client.getAdsense();
      if (error) throw fromApiError(error, response);
      print(data, format);
    });

  annotate(
    withYesOption(
      settings
        .command('delete-hero')
        .description('Remove the hero image (storage object + reference).'),
    ).action(async function (this: Command) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: 'Delete the hero image (storage object + reference)?',
        yes: opts.yes,
      });
      const client = getClient(this);
      const { error, response } = await client.deleteHero();
      if (error) throw fromApiError(error, response);
      console.log('Hero image cleared.');
    }),
    {
      mapsTo: 'DELETE /v1/settings/hero',
      examples: ['cavuno settings delete-hero --yes'],
    },
  );

  settings
    .command('update-adsense')
    .description('Update the AdSense configuration.')
    .option('--enabled <bool>', 'Toggle AdSense (true/false)')
    .option(
      '--client-id <id>',
      'AdSense publisher id (ca-pub-…); pass empty string to clear',
    )
    .option(
      '--ads-txt <text>',
      'Inline ads.txt content; pass empty string to clear',
    )
    .option(
      '--slots-json <json>',
      'AdSense slots as JSON: \'{"slot_a":{"enabled":true,"slotId":"123"}}\'',
    )
    .action(async function (this: Command) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<Record<string, string | undefined>>();
      const body: Record<string, unknown> = {};
      if (opts.enabled !== undefined)
        body.adsenseEnabled = opts.enabled === 'true';
      if (opts.clientId !== undefined)
        body.adsenseClientId = opts.clientId === '' ? null : opts.clientId;
      if (opts.adsTxt !== undefined)
        body.adsTxt = opts.adsTxt === '' ? null : opts.adsTxt;
      if (opts.slotsJson !== undefined) {
        try {
          body.adsenseSlots = JSON.parse(opts.slotsJson) as unknown;
        } catch (err) {
          console.error(
            `--slots-json could not be parsed as JSON: ${(err as Error).message}`,
          );
          process.exit(2);
        }
      }
      if (Object.keys(body).length === 0) {
        console.error('No fields to update — pass at least one --flag.');
        process.exit(2);
      }
      const { data, error, response } = await client.updateAdsense(
        body as Parameters<typeof client.updateAdsense>[0],
      );
      if (error) throw fromApiError(error, response);
      print(data, format);
    });

  settings
    .command('set-password-protection')
    .description(
      'Enable board password protection. Reads the password from stdin to ' +
        'avoid leaking it via shell history. Pipe a password: echo "pw" | ' +
        'cavuno settings set-password-protection',
    )
    .action(async function (this: Command) {
      const client = getClient(this);
      const format = getFormat(this);
      const password = await readPasswordFromStdin();
      if (!password) {
        console.error(
          'No password provided on stdin. Pipe a password: ' +
            'echo "pw" | cavuno settings set-password-protection',
        );
        process.exit(2);
      }
      const { data, error, response } = await client.setPasswordProtection({
        password,
      });
      if (error) throw fromApiError(error, response);
      print(data, format);
    });

  annotate(
    withYesOption(
      settings
        .command('delete-password-protection')
        .description(
          'Disable board password protection (clears the stored hash).',
        ),
    ).action(async function (this: Command) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message:
          'Disable password protection? The board becomes publicly accessible.',
        yes: opts.yes,
      });
      const client = getClient(this);
      const { error, response } = await client.clearPasswordProtection();
      if (error) throw fromApiError(error, response);
      console.log('Password protection disabled.');
    }),
    {
      mapsTo: 'DELETE /v1/settings/password-protection',
      examples: ['cavuno settings delete-password-protection --yes'],
    },
  );

  annotate(
    settings
      .command('job-form-set-custom-fields')
      .description(
        'Replace the board custom job field definitions (whole-array PUT). ' +
          'Pass JSON via --file or stdin: { "customFields": [...] }. ' +
          'Empty array removes all. Changing type on an existing key is rejected.',
      )
      .option('--file <path>', 'JSON file body (otherwise read stdin)')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ file?: string }>();
        const body = await readJobFormCustomFieldsBody(opts.file);
        const { data, error, response } = await client.setJobFormCustomFields(
          body as Parameters<typeof client.setJobFormCustomFields>[0],
        );
        if (error) throw fromApiError(error, response);
        print(data, format);
      }),
    {
      mapsTo: 'PUT /v1/settings/job-form/custom-fields',
      examples: [
        'cavuno settings job-form-set-custom-fields --file custom-fields.json',
      ],
    },
  );
}

async function readJobFormCustomFieldsBody(
  file?: string,
): Promise<{ customFields: unknown[] }> {
  const parsed = await readJsonBodyFromFileOrStdin(file, {
    command: 'job-form-set-custom-fields',
    shapeHint: '{ "customFields": [...] }',
  });
  // JSON.parse can legally return null/arrays/primitives — guard objectness
  // before reading `.customFields` so `null` stays a clean exit-2, not a
  // TypeError exit-10.
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as { customFields?: unknown }).customFields)
  ) {
    console.error(
      'job-form-set-custom-fields: body must be { "customFields": [...] }',
    );
    process.exit(2);
  }
  return parsed as { customFields: unknown[] };
}

async function readPasswordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}
