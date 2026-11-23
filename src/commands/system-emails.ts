import { Command } from 'commander';

import { createSystemEmailsClient } from '../api/system-emails.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';

import { readFile } from 'node:fs/promises';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(cmd: Command) {
  const opts = cmd.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createSystemEmailsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(cmd: Command): OutputFormat {
  return cmd.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

const listRows = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

export function registerSystemEmailsCommand(root: Command): void {
  const emails = root
    .command('system-emails')
    .description(
      'Reword the emails your board sends, and choose the template each uses.',
    );

  annotate(
    emails
      .command('list')
      .description('List the system emails, with recipient and template.')
      .action(async function (this: Command) {
        const r = await getClient(this).list();
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listRows);
      }),
    {
      mapsTo: 'GET /v1/system-emails',
      examples: ['cavuno system-emails list'],
    },
  );

  annotate(
    emails
      .command('get')
      .description('Fetch the wording in effect for one email.')
      .argument('<type>', 'Email type, such as board-magic-link')
      .action(async function (this: Command, type: string) {
        const r = await getClient(this).get(type);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/system-emails/:type',
      examples: ['cavuno system-emails get board-magic-link'],
    },
  );

  annotate(
    emails
      .command('publish')
      .description('Publish new wording for an email.')
      .argument('<type>', 'Email type')
      .requiredOption('--subject <text>', 'Subject line (required)')
      .requiredOption(
        '--body-file <path>',
        'File with the body HTML (required)',
      )
      .option('--preview <text>', 'Inbox preview text', '')
      .action(async function (this: Command, type: string) {
        const opts = this.opts<{
          subject: string;
          bodyFile: string;
          preview: string;
        }>();
        const r = await getClient(this).publish(type, {
          subject: opts.subject,
          previewText: opts.preview,
          bodyHtml: await readFile(opts.bodyFile, 'utf8'),
        });
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PUT /v1/system-emails/:type',
      examples: [
        'cavuno system-emails publish board-magic-link --subject "Log in to {{board_name}}" --body-file body.html',
      ],
    },
  );

  annotate(
    emails
      .command('set-layout')
      .description('Choose the template an email is sent with.')
      .argument('<type>', 'Email type')
      .argument('<layoutId>', 'Template ID, or system')
      .action(async function (this: Command, type: string, layoutId: string) {
        const r = await getClient(this).setLayout(type, layoutId);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PUT /v1/system-emails/:type/layout',
      examples: ['cavuno system-emails set-layout board-magic-link system'],
    },
  );

  annotate(
    emails
      .command('test')
      .description('Send the email in effect to your own inbox.')
      .argument('<type>', 'Email type')
      .action(async function (this: Command, type: string) {
        const r = await getClient(this).test(type);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/system-emails/:type/test',
      examples: ['cavuno system-emails test board-magic-link'],
    },
  );

  annotate(
    withYesOption(
      emails
        .command('reset')
        .description('Go back to the default wording.')
        .argument('<type>', 'Email type'),
    ).action(async function (this: Command, type: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Reset ${type} to its default wording?`,
        yes: opts.yes,
      });
      const r = await getClient(this).reset(type);
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/system-emails/:type',
      examples: ['cavuno system-emails reset board-magic-link --yes'],
    },
  );
}
