import { Command } from 'commander';

import { createEmailLayoutsClient } from '../api/email-layouts.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(cmd: Command) {
  const opts = cmd.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createEmailLayoutsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(cmd: Command): OutputFormat {
  return cmd.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

const listRows = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

/** The `.ts` and `.tsx` files at the top of a template directory. */
async function readTemplateFiles(dir: string) {
  const names = (await readdir(dir)).filter((name) => /\.tsx?$/.test(name));
  return Promise.all(
    names.sort().map(async (path) => ({
      path,
      contents: await readFile(join(dir, path), 'utf8'),
    })),
  );
}

export function registerEmailLayoutsCommand(root: Command): void {
  const layouts = root
    .command('email-layouts')
    .description(
      'Design the email templates your board emails use. `system` names the System template.',
    );

  annotate(
    layouts
      .command('list')
      .description('List the email templates, System first.')
      .action(async function (this: Command) {
        const r = await getClient(this).list();
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listRows);
      }),
    {
      mapsTo: 'GET /v1/email-layouts',
      examples: ['cavuno email-layouts list'],
    },
  );

  annotate(
    layouts
      .command('get')
      .description('Fetch a template with its draft source and problems.')
      .argument('<id>', 'Template ID, or system')
      .action(async function (this: Command, id: string) {
        const r = await getClient(this).get(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/email-layouts/:id',
      examples: ['cavuno email-layouts get system'],
    },
  );

  annotate(
    layouts
      .command('create')
      .description('Create a template as a copy of System or another template.')
      .requiredOption('--name <name>', 'Template name (required)')
      .option('--copy-from <id>', 'Template to copy (defaults to system)')
      .action(async function (this: Command) {
        const opts = this.opts<{ name: string; copyFrom?: string }>();
        const r = await getClient(this).create({
          name: opts.name,
          ...(opts.copyFrom ? { copyFrom: opts.copyFrom } : {}),
        });
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/email-layouts',
      examples: ['cavuno email-layouts create --name "Plain"'],
    },
  );

  annotate(
    layouts
      .command('duplicate')
      .description('Create a new template from this template’s draft.')
      .argument('<id>', 'Template ID, or system')
      .option('--name <name>', 'Name of the copy')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ name?: string }>();
        const r = await getClient(this).duplicate(
          id,
          opts.name ? { name: opts.name } : {},
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/email-layouts/:id/duplicate',
      examples: ['cavuno email-layouts duplicate system --name "Plain"'],
    },
  );

  annotate(
    layouts
      .command('rename')
      .description('Rename a template.')
      .argument('<id>', 'Template ID, or system')
      .requiredOption('--name <name>', 'New name (required)')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ name: string }>();
        const r = await getClient(this).rename(id, opts.name);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PATCH /v1/email-layouts/:id',
      examples: ['cavuno email-layouts rename el_123 --name "Plain"'],
    },
  );

  annotate(
    layouts
      .command('draft')
      .description(
        'Replace the draft with the .ts/.tsx files in a directory and compile it. Prints the compile operation.',
      )
      .argument('<id>', 'Template ID, or system')
      .requiredOption('--dir <path>', 'Directory holding template.tsx')
      .requiredOption(
        '--base-revision <n>',
        'The draft.revision you read',
        (v) => parseInt(v, 10),
      )
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ dir: string; baseRevision: number }>();
        const r = await getClient(this).updateDraft(id, {
          baseRevision: opts.baseRevision,
          files: await readTemplateFiles(opts.dir),
        });
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PUT /v1/email-layouts/:id/draft',
      examples: [
        'cavuno email-layouts draft system --dir ./template --base-revision 3',
      ],
    },
  );

  annotate(
    layouts
      .command('publish')
      .description(
        'Check the draft against every email that can use it and make it live. Prints the publish operation.',
      )
      .argument('<id>', 'Template ID, or system')
      .action(async function (this: Command, id: string) {
        const r = await getClient(this).publish(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/email-layouts/:id/publish',
      examples: ['cavuno email-layouts publish system'],
    },
  );

  annotate(
    layouts
      .command('versions')
      .description('List published versions, newest first.')
      .argument('<id>', 'Template ID, or system')
      .option('--limit <n>', 'Page size 1-50 (default 25)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'nextCursor from the previous page')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ limit?: number; cursor?: string }>();
        const r = await getClient(this).listVersions(id, {
          ...(opts.limit ? { limit: opts.limit } : {}),
          ...(opts.cursor ? { cursor: opts.cursor } : {}),
        });
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listRows);
      }),
    {
      mapsTo: 'GET /v1/email-layouts/:id/versions',
      examples: ['cavuno email-layouts versions system'],
    },
  );

  annotate(
    layouts
      .command('version')
      .description('Fetch a published version with its source and HTML.')
      .argument('<id>', 'Template ID, or system')
      .argument('<versionId>', 'Version ID')
      .action(async function (this: Command, id: string, versionId: string) {
        const r = await getClient(this).getVersion(id, versionId);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/email-layouts/:id/versions/:versionId',
      examples: ['cavuno email-layouts version system elv_123'],
    },
  );

  annotate(
    layouts
      .command('restore')
      .description(
        'Copy a version into the draft. Publish it to make it live again.',
      )
      .argument('<id>', 'Template ID, or system')
      .argument('<versionId>', 'Version ID')
      .requiredOption(
        '--base-revision <n>',
        'The draft.revision you read',
        (v) => parseInt(v, 10),
      )
      .action(async function (this: Command, id: string, versionId: string) {
        const opts = this.opts<{ baseRevision: number }>();
        const r = await getClient(this).restoreVersion(
          id,
          versionId,
          opts.baseRevision,
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/email-layouts/:id/versions/:versionId/restore',
      examples: [
        'cavuno email-layouts restore system elv_123 --base-revision 4',
      ],
    },
  );

  annotate(
    layouts
      .command('test')
      .description(
        'Send yourself one email rendered with the template’s draft.',
      )
      .argument('<id>', 'Template ID, or system')
      .requiredOption(
        '--email-type <type>',
        'Email to render, for example board-magic-link',
      )
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ emailType: string }>();
        const r = await getClient(this).test(id, {
          emailType: opts.emailType as never,
        });
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/email-layouts/:id/test',
      examples: [
        'cavuno email-layouts test system --email-type board-magic-link',
      ],
    },
  );

  annotate(
    withYesOption(
      layouts
        .command('remove')
        .description('Delete a template and its versions.')
        .argument('<id>', 'Template ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete email template ${id} and its versions?`,
        yes: opts.yes,
      });
      const r = await getClient(this).remove(id);
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/email-layouts/:id',
      examples: ['cavuno email-layouts remove el_123 --yes'],
    },
  );
}
