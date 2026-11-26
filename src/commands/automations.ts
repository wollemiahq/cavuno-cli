import { Command } from 'commander';

import { createAutomationsClient } from '../api/automations.js';
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
  return createAutomationsClient({
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

type Result = { error?: unknown; response: Response; data?: unknown };

async function run(cmd: Command, call: Promise<Result>) {
  const r = await call;
  if (r.error) throw fromApiError(r.error as never, r.response);
  print(r.data, getFormat(cmd));
}

export function registerAutomationsCommand(root: Command): void {
  const automations = root
    .command('automations')
    .description(
      'Emails that go out when something happens: the defaults and your own. Edits go into a draft until you publish.',
    );

  annotate(
    automations
      .command('list')
      .description('List the defaults, then your own automations.')
      .action(async function (this: Command) {
        const r = await getClient(this).list();
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listRows);
      }),
    { mapsTo: 'GET /v1/automations', examples: ['cavuno automations list'] },
  );

  annotate(
    automations
      .command('get')
      .description('Fetch an automation with its steps, emails and checks.')
      .argument(
        '<id>',
        'Automation ID, or a default key such as new_application',
      )
      .action(async function (this: Command, id: string) {
        await run(this, getClient(this).get(id));
      }),
    {
      mapsTo: 'GET /v1/automations/:id',
      examples: ['cavuno automations get new_application'],
    },
  );

  annotate(
    automations
      .command('create')
      .description('Create a draft automation. Nothing runs until you publish.')
      .requiredOption('--name <text>', 'Name in the dashboard')
      .requiredOption(
        '--trigger <kind>',
        'Trigger, such as application_received',
      )
      .option('--days-before <n>', 'Date-relative triggers: days before', (v) =>
        Number(v),
      )
      .option('--re-entry <mode>', 'once, after_finish or per_job')
      .option('--definition-file <path>', 'JSON file with the step graph')
      .action(async function (this: Command) {
        const opts = this.opts<{
          name: string;
          trigger: string;
          daysBefore?: number;
          reEntry?: string;
          definitionFile?: string;
        }>();
        await run(
          this,
          getClient(this).create({
            name: opts.name,
            trigger: {
              kind: opts.trigger,
              ...(opts.daysBefore !== undefined && {
                daysBefore: opts.daysBefore,
              }),
            } as never,
            ...(opts.reEntry !== undefined && {
              reEntry: opts.reEntry as never,
            }),
            ...(opts.definitionFile !== undefined && {
              definition: await readJson(opts.definitionFile),
            }),
          }),
        );
      }),
    {
      mapsTo: 'POST /v1/automations',
      examples: [
        'cavuno automations create --name "Nudge the team" --trigger application_received --definition-file flow.json',
      ],
    },
  );

  annotate(
    automations
      .command('update')
      .description(
        'Edit an automation. While live, the edit waits for publish.',
      )
      .argument('<id>', 'Automation ID')
      .requiredOption('--file <path>', 'JSON body, with baseRevision')
      .action(async function (this: Command, id: string) {
        const { file } = this.opts<{ file: string }>();
        await run(this, getClient(this).update(id, await readJson(file)));
      }),
    {
      mapsTo: 'PATCH /v1/automations/:id',
      examples: ['cavuno automations update aut_123 --file edit.json'],
    },
  );

  annotate(
    automations
      .command('email')
      .description("Write a Send email step's email from a JSON body.")
      .argument('<id>', 'Automation ID')
      .argument('<stepId>', 'Send email step ID')
      .requiredOption(
        '--file <path>',
        'JSON body: subject, previewText, bodyHtml',
      )
      .action(async function (this: Command, id: string, stepId: string) {
        const { file } = this.opts<{ file: string }>();
        await run(
          this,
          getClient(this).updateEmail(id, stepId, await readJson(file)),
        );
      }),
    {
      mapsTo: 'PUT /v1/automations/:id/emails/:stepId',
      examples: ['cavuno automations email aut_123 reminder --file email.json'],
    },
  );

  annotate(
    automations
      .command('duplicate')
      .description('Copy an automation and its emails as a draft.')
      .argument('<id>', 'Automation ID')
      .action(async function (this: Command, id: string) {
        await run(this, getClient(this).duplicate(id));
      }),
    {
      mapsTo: 'POST /v1/automations/:id/duplicate',
      examples: ['cavuno automations duplicate aut_123'],
    },
  );

  annotate(
    automations
      .command('test')
      .description(
        'Run the latest edits once for the most recent record, or a sample. Nothing is sent.',
      )
      .argument('<id>', 'Automation ID')
      .option('--sample', 'Run as a sample person')
      .action(async function (this: Command, id: string) {
        const { sample } = this.opts<{ sample?: boolean }>();
        await run(this, getClient(this).test(id, sample ? { sample } : {}));
      }),
    {
      mapsTo: 'POST /v1/automations/:id/test',
      examples: ['cavuno automations test aut_123'],
    },
  );

  annotate(
    automations
      .command('pause')
      .description('Hold everyone at their step; publish resumes it.')
      .argument('<id>', 'Automation ID')
      .action(async function (this: Command, id: string) {
        await run(this, getClient(this).pause(id));
      }),
    {
      mapsTo: 'POST /v1/automations/:id/pause',
      examples: ['cavuno automations pause aut_123'],
    },
  );

  const confirmed = (
    name: 'publish' | 'stop' | 'delete',
    description: string,
    message: (id: string) => string,
    mapsTo: string,
  ) =>
    annotate(
      withYesOption(
        automations
          .command(name)
          .description(description)
          .argument('<id>', 'Automation ID'),
      ).action(async function (this: Command, id: string) {
        const opts = this.opts<ConfirmOptions>();
        await confirmOrAbort({ message: message(id), yes: opts.yes });
        const client = getClient(this);
        if (name === 'delete') {
          const r = await client.delete(id);
          if (r.error) throw fromApiError(r.error, r.response);
          return;
        }
        await run(
          this,
          name === 'publish' ? client.publish(id) : client.stop(id),
        );
      }),
      { mapsTo, examples: [`cavuno automations ${name} aut_123 --yes`] },
    );

  confirmed(
    'publish',
    'Turn on, or resume, with the latest edits. People who trigger it from now on get its emails.',
    (id) => `Publish automation ${id}? It emails people from now on.`,
    'POST /v1/automations/:id/publish',
  );
  confirmed(
    'stop',
    'Turn off: everyone in it leaves now.',
    (id) => `Turn off automation ${id}? Everyone in it leaves.`,
    'POST /v1/automations/:id/stop',
  );
  confirmed(
    'delete',
    'Delete a draft or turned-off automation and its emails.',
    (id) => `Delete automation ${id}? This cannot be undone.`,
    'DELETE /v1/automations/:id',
  );

  annotate(
    automations
      .command('enrolments')
      .description('List the people going, or who went, through it.')
      .argument('<id>', 'Automation ID')
      .option('--status <status>', 'waiting, completed or exited')
      .option('--limit <n>', 'Runs per page', (v) => Number(v))
      .option('--cursor <cursor>', 'nextCursor from the previous page')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{
          status?: 'waiting' | 'completed' | 'exited';
          limit?: number;
          cursor?: string;
        }>();
        const r = await getClient(this).enrolments(id, opts);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listRows);
      }),
    {
      mapsTo: 'GET /v1/automations/:id/enrolments',
      examples: ['cavuno automations enrolments aut_123 --status waiting'],
    },
  );
}
