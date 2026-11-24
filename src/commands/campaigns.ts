import { Command } from 'commander';

import {
  createCampaignsClient,
  type CreateCampaignBody,
} from '../api/campaigns.js';
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

interface ContentOpts {
  name?: string;
  subject?: string;
  preview?: string;
  bodyFile?: string;
  layout?: string;
  audienceFile?: string;
  fallbacksFile?: string;
}

function getClient(cmd: Command) {
  const opts = cmd.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createCampaignsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(cmd: Command): OutputFormat {
  return cmd.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

const listRows = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

const readJson = async (path: string) =>
  JSON.parse(await readFile(path, 'utf8')) as never;

function withContentOptions(cmd: Command): Command {
  return cmd
    .option('--name <text>', 'Name in the dashboard')
    .option('--subject <text>', 'Subject line')
    .option('--preview <text>', 'Inbox preview text')
    .option('--body-file <path>', 'File with the body HTML')
    .option('--layout <id>', 'Template: newsletter, system, or a template ID')
    .option(
      '--audience-file <path>',
      'JSON file with the audience ({ topicKey, include, exclude })',
    )
    .option(
      '--fallbacks-file <path>',
      'JSON file with token fallbacks, such as { "first_name": "there" }',
    );
}

async function contentBody(opts: ContentOpts): Promise<CreateCampaignBody> {
  return {
    ...(opts.name !== undefined && { name: opts.name }),
    ...(opts.subject !== undefined && { subject: opts.subject }),
    ...(opts.preview !== undefined && { previewText: opts.preview }),
    ...(opts.bodyFile !== undefined && {
      bodyHtml: await readFile(opts.bodyFile, 'utf8'),
    }),
    ...(opts.layout !== undefined && { layoutId: opts.layout }),
    ...(opts.audienceFile !== undefined && {
      audience: await readJson(opts.audienceFile),
    }),
    ...(opts.fallbacksFile !== undefined && {
      tokenFallbacks: await readJson(opts.fallbacksFile),
    }),
  };
}

export function registerCampaignsCommand(root: Command): void {
  const campaigns = root
    .command('campaigns')
    .description(
      'Draft one-off emails to your contacts, send yourself a test, and run the pre-send checks.',
    );

  annotate(
    campaigns
      .command('list')
      .description('List campaigns, the most recently edited first.')
      .option('--status <status>', 'Only this status, such as draft')
      .option('--limit <n>', 'Campaigns per page', (v) => Number(v))
      .option('--cursor <cursor>', 'nextCursor from the previous page')
      .action(async function (this: Command) {
        const opts = this.opts<{
          status?: 'draft' | 'scheduled' | 'sending' | 'sent' | 'stopped';
          limit?: number;
          cursor?: string;
        }>();
        const r = await getClient(this).list(opts);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listRows);
      }),
    {
      mapsTo: 'GET /v1/campaigns',
      examples: ['cavuno campaigns list --status draft'],
    },
  );

  annotate(
    campaigns
      .command('get')
      .description('Fetch a campaign with its body and latest checks.')
      .argument('<id>', 'Campaign ID')
      .action(async function (this: Command, id: string) {
        const r = await getClient(this).get(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/campaigns/:id',
      examples: ['cavuno campaigns get cmp_123'],
    },
  );

  annotate(
    withContentOptions(
      campaigns
        .command('create')
        .description('Create a draft campaign. Nothing is sent.'),
    ).action(async function (this: Command) {
      const r = await getClient(this).create(
        await contentBody(this.opts<ContentOpts>()),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/campaigns',
      examples: [
        'cavuno campaigns create --name "November roundup" --subject "New jobs this month" --body-file body.html',
      ],
    },
  );

  annotate(
    withContentOptions(
      campaigns
        .command('update')
        .description('Change a draft campaign. Only the options given change.')
        .argument('<id>', 'Campaign ID')
        .option(
          '--base-revision <n>',
          'Refuse the update if the campaign changed since this revision',
          (v) => Number(v),
        ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ContentOpts & { baseRevision?: number }>();
      const r = await getClient(this).update(id, {
        ...(await contentBody(opts)),
        ...(opts.baseRevision !== undefined && {
          baseRevision: opts.baseRevision,
        }),
      });
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/campaigns/:id',
      examples: ['cavuno campaigns update cmp_123 --subject "Fresh jobs"'],
    },
  );

  annotate(
    campaigns
      .command('duplicate')
      .description('Copy a campaign into a new draft.')
      .argument('<id>', 'Campaign ID')
      .action(async function (this: Command, id: string) {
        const r = await getClient(this).duplicate(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/campaigns/:id/duplicate',
      examples: ['cavuno campaigns duplicate cmp_123'],
    },
  );

  annotate(
    campaigns
      .command('test')
      .description('Send the campaign to your own inbox.')
      .argument('<id>', 'Campaign ID')
      .action(async function (this: Command, id: string) {
        const r = await getClient(this).test(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/campaigns/:id/test',
      examples: ['cavuno campaigns test cmp_123'],
    },
  );

  annotate(
    campaigns
      .command('verify')
      .description(
        'Run the pre-send checks (links, tokens, audience, deliverability). Returns an operation.',
      )
      .argument('<id>', 'Campaign ID')
      .action(async function (this: Command, id: string) {
        const r = await getClient(this).verify(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/campaigns/:id/verify',
      examples: ['cavuno campaigns verify cmp_123'],
    },
  );

  annotate(
    withYesOption(
      campaigns
        .command('schedule')
        .description(
          'Send the campaign now, or at --at. Its checks must be current with nothing blocking.',
        )
        .argument('<id>', 'Campaign ID')
        .option('--at <datetime>', 'ISO 8601 datetime to start sending'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions & { at?: string }>();
      await confirmOrAbort({
        message: opts.at
          ? `Schedule campaign ${id} to send at ${opts.at}?`
          : `Send campaign ${id} now?`,
        yes: opts.yes,
      });
      const r = await getClient(this).schedule(
        id,
        opts.at ? { sendAt: opts.at } : {},
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/campaigns/:id/schedule',
      examples: [
        'cavuno campaigns schedule cmp_123 --at 2026-12-01T09:00:00Z --yes',
      ],
    },
  );

  annotate(
    campaigns
      .command('unschedule')
      .description('Take a scheduled campaign back to draft.')
      .argument('<id>', 'Campaign ID')
      .action(async function (this: Command, id: string) {
        const r = await getClient(this).unschedule(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/campaigns/:id/unschedule',
      examples: ['cavuno campaigns unschedule cmp_123'],
    },
  );

  annotate(
    withYesOption(
      campaigns
        .command('stop')
        .description('Stop sending a campaign. It cannot be resumed.')
        .argument('<id>', 'Campaign ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Stop sending campaign ${id}?`,
        yes: opts.yes,
      });
      const r = await getClient(this).stop(id);
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/campaigns/:id/stop',
      examples: ['cavuno campaigns stop cmp_123 --yes'],
    },
  );

  annotate(
    campaigns
      .command('report')
      .description('Sent, delivered, bounced, spam and unsubscribes.')
      .argument('<id>', 'Campaign ID')
      .action(async function (this: Command, id: string) {
        const r = await getClient(this).report(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/campaigns/:id/report',
      examples: ['cavuno campaigns report cmp_123'],
    },
  );

  annotate(
    withYesOption(
      campaigns
        .command('delete')
        .description('Delete a draft campaign.')
        .argument('<id>', 'Campaign ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete campaign ${id}?`,
        yes: opts.yes,
      });
      const r = await getClient(this).delete(id);
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/campaigns/:id',
      examples: ['cavuno campaigns delete cmp_123 --yes'],
    },
  );
}
