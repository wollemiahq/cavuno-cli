import { Command } from 'commander';

import { createMeClient } from '../api/me.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createMeClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

export function registerMeCommand(root: Command): void {
  const me = root
    .command('me')
    .description(
      'Show the authenticated operator identity (Board, role, permissions, scopes).',
    );

  annotate(
    me
      .command('get')
      .description(
        'Retrieve the current Board, actor type, live role/permissions, and credential scopes.',
      )
      .action(async function (this: Command) {
        const { data, error, response } = await getClient(this).get();
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/me',
      examples: ['cavuno me get'],
    },
  );
}
