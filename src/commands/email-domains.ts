import { Command } from 'commander';

import { createEmailDomainsClient } from '../api/email-domains.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

interface SenderOpts {
  senderName?: string;
  senderLocalPart?: string;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createEmailDomainsClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
}

function senderBody(opts: SenderOpts) {
  return {
    ...(opts.senderName !== undefined ? { senderName: opts.senderName } : {}),
    ...(opts.senderLocalPart !== undefined
      ? { senderLocalPart: opts.senderLocalPart }
      : {}),
  };
}

export function registerEmailDomainsCommand(root: Command): void {
  const emailDomains = root
    .command('email-domains')
    .description(
      'Manage the custom email sender domain for the authenticated account.',
    );

  annotate(
    emailDomains
      .command('list')
      .description('List the email sender domain (a board has at most one).')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.list();
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          format,
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/email-domains',
      examples: ['cavuno email-domains list'],
    },
  );

  annotate(
    emailDomains
      .command('get')
      .description(
        'Fetch an email sender domain with its status and DNS records.',
      )
      .argument('<id>', 'Email domain ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.get(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/email-domains/:id',
      examples: ['cavuno email-domains get ed_123'],
    },
  );

  annotate(
    emailDomains
      .command('add')
      .description(
        'Add an email sender domain and print the DNS records to publish.',
      )
      .argument('<host>', 'Hostname, for example notifications.example.com')
      .option(
        '--sender-name <name>',
        'From display name (defaults to the board name)',
      )
      .option(
        '--sender-local-part <mailbox>',
        'Mailbox before the @ (defaults to info)',
      )
      .action(async function (this: Command, host: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<SenderOpts>();
        const r = await client.add({ domain: host, ...senderBody(opts) });
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/email-domains',
      examples: [
        'cavuno email-domains add notifications.example.com',
        'cavuno email-domains add notifications.example.com --sender-name "Acme Jobs" --sender-local-part hello',
      ],
    },
  );

  annotate(
    emailDomains
      .command('update')
      .description('Change the sender name or mailbox of a verified domain.')
      .argument('<id>', 'Email domain ID')
      .option('--sender-name <name>', 'From display name')
      .option('--sender-local-part <mailbox>', 'Mailbox before the @')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<SenderOpts>();
        const body = senderBody(opts);
        if (Object.keys(body).length === 0) {
          console.error('Pass --sender-name, --sender-local-part, or both.');
          process.exit(2);
        }
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.update(id, body);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'PATCH /v1/email-domains/:id',
      examples: [
        'cavuno email-domains update ed_123 --sender-name "Acme Jobs"',
      ],
    },
  );

  annotate(
    emailDomains
      .command('verify')
      .description('Check the DNS records now and print the updated domain.')
      .argument('<id>', 'Email domain ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.verify(id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'POST /v1/email-domains/:id/verify',
      examples: ['cavuno email-domains verify ed_123'],
    },
  );

  annotate(
    withYesOption(
      emailDomains
        .command('remove')
        .description('Delete the email sender domain.')
        .argument('<id>', 'Email domain ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete email sender domain ${id}?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = await client.remove(id);
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/email-domains/:id',
      examples: ['cavuno email-domains remove ed_123 --yes'],
    },
  );
}
