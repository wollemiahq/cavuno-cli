import { Command } from 'commander';

import { createTodosClient } from '../api/todos.js';
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
  return createTodosClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

export function registerTodosCommand(root: Command): void {
  const todos = root
    .command('todos')
    .description(
      "Read the to-dos on the Board's Home, the same list the dashboard shows.",
    );

  annotate(
    todos
      .command('list')
      .description(
        'List the Board’s to-dos in Home’s order, with status and the dashboard link for each. While the Board is being set up these are its setup steps.',
      )
      .action(async function (this: Command) {
        const { data, error, response } = await getClient(this).list();
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/todos',
      examples: ['cavuno todos list'],
    },
  );
}
