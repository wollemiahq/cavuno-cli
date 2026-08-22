import { Command } from 'commander';

import { createDomainsClient } from '../api/domains.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';
import { printOrWait, type WaitOptions, withWaitOption } from '../lib/wait.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createDomainsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
}

function parseIntArg(flag: string) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      console.error(`${flag}: expected an integer, got ${raw}`);
      process.exit(2);
    }
    if (n < 1 || n > 50) {
      console.error(`${flag}: expected an integer from 1 to 50, got ${raw}`);
      process.exit(2);
    }
    return n;
  };
}

export function registerDomainsCommand(root: Command): void {
  const domains = root
    .command('domains')
    .description('Manage custom domains for the authenticated account.');

  annotate(
    domains
      .command('list')
      .description('List custom domains.')
      .option(
        '--limit <n>',
        'Page size 1-50 (default 50)',
        parseIntArg('--limit'),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ limit?: number; cursor?: string }>();
        const r = await client.list(opts);
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          format,
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/domains',
      examples: ['cavuno domains list'],
    },
  );

  annotate(
    domains
      .command('get')
      .description('Fetch a custom domain by ID.')
      .argument('<id>', 'Domain ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.get(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/domains/:id',
      examples: ['cavuno domains get domain_123'],
    },
  );

  annotate(
    domains
      .command('add')
      .description('Add a custom domain and print verification instructions.')
      .argument('<host>', 'Hostname, for example jobs.example.com')
      .action(async function (this: Command, host: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.add({ domain: host });
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/domains',
      examples: ['cavuno domains add jobs.example.com'],
    },
  );

  annotate(
    withWaitOption(
      domains
        .command('verify')
        .description('Start custom-domain verification.')
        .argument('<id>', 'Domain ID'),
    ).action(async function (this: Command, id: string) {
      const client = getClient(this);
      const r = await client.verify(id);
      if (r.error) throw fromApiError(r.error, r.response);
      await printOrWait(this, r, this.opts<WaitOptions>());
    }),
    {
      mapsTo: 'POST /v1/domains/:id/verify',
      examples: [
        'cavuno domains verify domain_123',
        'cavuno domains verify domain_123 --wait',
      ],
    },
  );

  annotate(
    withYesOption(
      domains
        .command('remove')
        .description('Delete a custom domain.')
        .argument('<id>', 'Domain ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete custom domain ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = await client.remove(id);
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/domains/:id',
      examples: ['cavuno domains remove domain_123 --yes'],
    },
  );
}
