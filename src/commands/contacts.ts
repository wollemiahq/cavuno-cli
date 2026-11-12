import { Command } from 'commander';

import {
  createContactsClient,
  type ContactListQuery,
  type ContactSubscriptionKind,
} from '../api/contacts.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import {
  resolveIdempotency,
  type IdempotencyOptions,
  withIdempotencyOption,
} from '../lib/idempotency.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createContactsClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

const listExtractor = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

/** Prints a response, or throws its API error. A 204 prints nothing. */
async function run(
  command: Command,
  call: Promise<unknown>,
  extract?: typeof listExtractor,
): Promise<void> {
  const r = (await call) as ApiResponse;
  if (r.error) throw fromApiError(r.error, r.response);
  if (r.response.status === 204) return;
  print(
    r.data,
    command.optsWithGlobals<GlobalOpts>().format ?? 'json',
    extract,
  );
}

function choice<T extends string>(flag: string, allowed: readonly T[]) {
  return (raw: string): T => {
    if (!(allowed as readonly string[]).includes(raw)) {
      console.error(`${flag}: expected one of ${allowed.join(', ')}`);
      process.exit(2);
    }
    return raw as T;
  };
}

function parseLimit(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    console.error(`--limit: expected an integer from 1 to 100, got ${raw}`);
    process.exit(2);
  }
  return n;
}

const KINDS = ['job_alerts', 'job_matches', 'marketing'] as const;
const parseKind = choice<ContactSubscriptionKind>('<kind>', KINDS);

export function registerContactsCommand(root: Command): void {
  const contacts = root
    .command('contacts')
    .description(
      'Everyone the board can email, one row per person, with their job alerts, job matches and marketing consent. You can turn subscriptions off but never add one.',
    );

  annotate(
    contacts
      .command('list')
      .description('List contacts, newest first (paginated).')
      .option('--search <query>', 'Case-insensitive substring match on email')
      .option(
        '--status <status>',
        'subscribed | pending | waitlisted | unsubscribed | suppressed',
        choice('--status', [
          'subscribed',
          'pending',
          'waitlisted',
          'unsubscribed',
          'suppressed',
        ] as const),
      )
      .option(
        '--subscription <kind>',
        'Only contacts who still have this subscription: job_alerts | job_matches | marketing',
        choice('--subscription', KINDS),
      )
      .option(
        '--role <role>',
        'candidate | employer | subscriber (no sign-in on the board)',
        choice('--role', ['candidate', 'employer', 'subscriber'] as const),
      )
      .option(
        '--source <source>',
        'form | import | job_alert_form | sign_up',
        choice('--source', [
          'form',
          'import',
          'job_alert_form',
          'sign_up',
        ] as const),
      )
      .option('--limit <n>', 'Page size 1-100 (default 50)', parseLimit)
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const query: ContactListQuery = this.opts<ContactListQuery>();
        await run(this, getClient(this).list(query), listExtractor);
      }),
    {
      mapsTo: 'GET /v1/contacts',
      examples: [
        'cavuno contacts list',
        'cavuno contacts list --status suppressed',
        'cavuno contacts list --subscription marketing --search alice',
      ],
    },
  );

  const readById = (
    name: string,
    description: string,
    mapsTo: string,
    call: (
      client: ReturnType<typeof getClient>,
      id: string,
    ) => Promise<unknown>,
    extract?: typeof listExtractor,
  ) =>
    annotate(
      contacts
        .command(name)
        .description(description)
        .argument('<id>', 'Contact ID')
        .action(async function (this: Command, id: string) {
          await run(this, call(getClient(this), id), extract);
        }),
      { mapsTo, examples: [`cavuno contacts ${name} boardUsers_01EXAMPLE`] },
    );

  readById(
    'get',
    'Fetch one contact: status, suppression reason, each subscription with its status, source and last email.',
    'GET /v1/contacts/:id',
    (c, id) => c.get(id),
  );
  readById(
    'emails',
    'The emails sent to a contact and whether each was delivered, delayed or bounced. Opens and clicks are never recorded.',
    'GET /v1/contacts/:id/emails',
    (c, id) => c.emails(id),
    listExtractor,
  );
  readById(
    'activity',
    'What happened to a contact and when: signed up, confirmed, waitlisted, unsubscribed, suppressed.',
    'GET /v1/contacts/:id/activity',
    (c, id) => c.activity(id),
    listExtractor,
  );
  readById(
    'job-alerts',
    "A contact's job alerts, each with its criteria and frequency.",
    'GET /v1/contacts/:id/job-alerts',
    (c, id) => c.jobAlerts(id),
    listExtractor,
  );

  annotate(
    contacts
      .command('job-alert')
      .description("Fetch one of a contact's job alerts.")
      .argument('<id>', 'Contact ID')
      .argument('<alertId>', 'Job alert ID')
      .action(async function (this: Command, id: string, alertId: string) {
        await run(this, getClient(this).jobAlert(id, alertId));
      }),
    {
      mapsTo: 'GET /v1/contacts/:id/job-alerts/:alertId',
      examples: [
        'cavuno contacts job-alert boardUsers_01EXAMPLE jobAlerts_01EXAMPLE',
      ],
    },
  );

  annotate(
    contacts
      .command('subscription')
      .description("Fetch one of a contact's subscriptions and its status.")
      .argument('<id>', 'Contact ID')
      .argument('<kind>', 'job_alerts | job_matches | marketing', parseKind)
      .action(async function (
        this: Command,
        id: string,
        kind: ContactSubscriptionKind,
      ) {
        await run(this, getClient(this).subscription(id, kind));
      }),
    {
      mapsTo: 'GET /v1/contacts/:id/subscriptions/:kind',
      examples: ['cavuno contacts subscription boardUsers_01EXAMPLE marketing'],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        contacts
          .command('unsubscribe')
          .description(
            'Stop every email to a contact: job alerts, job matches and marketing. Recorded as your team’s unsubscribe; see `resubscribe` for bringing them back.',
          )
          .argument('<id>', 'Contact ID'),
      ),
    ).action(async function (this: Command, id: string) {
      await confirmOrAbort({
        message: `Unsubscribe contact ${id} from everything?`,
        yes: this.opts<ConfirmOptions>().yes,
      });
      const idempotency = resolveIdempotency(this.opts<IdempotencyOptions>());
      await run(this, getClient(this).unsubscribe(id, idempotency));
    }),
    {
      mapsTo: 'POST /v1/contacts/:id/unsubscribe',
      examples: ['cavuno contacts unsubscribe boardUsers_01EXAMPLE --yes'],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        contacts
          .command('resubscribe')
          .description(
            'Bring back an unsubscribed contact. Undoes it at once when your team made every unsubscribe and the address is confirmed (outcome resubscribed). Otherwise, when job alerts are off, emails a confirmation link and their alerts come back on the click (outcome confirmation_sent). Refused (409) when only job matches or marketing the person turned off themselves are off.',
          )
          .argument('<id>', 'Contact ID'),
      ),
    ).action(async function (this: Command, id: string) {
      await confirmOrAbort({
        message: `Resubscribe contact ${id}? This may email them a confirmation link.`,
        yes: this.opts<ConfirmOptions>().yes,
      });
      const idempotency = resolveIdempotency(this.opts<IdempotencyOptions>());
      await run(this, getClient(this).resubscribe(id, idempotency));
    }),
    {
      mapsTo: 'POST /v1/contacts/:id/resubscribe',
      examples: ['cavuno contacts resubscribe boardUsers_01EXAMPLE --yes'],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        contacts
          .command('remove-subscription')
          .description(
            'Turn off one of a contact’s subscriptions. Job alerts stay saved but stop; marketing is withdrawn as an operator request.',
          )
          .argument('<id>', 'Contact ID')
          .argument(
            '<kind>',
            'job_alerts | job_matches | marketing',
            parseKind,
          ),
      ),
    ).action(async function (
      this: Command,
      id: string,
      kind: ContactSubscriptionKind,
    ) {
      await confirmOrAbort({
        message: `Turn off ${kind} for contact ${id}?`,
        yes: this.opts<ConfirmOptions>().yes,
      });
      const idempotency = resolveIdempotency(this.opts<IdempotencyOptions>());
      await run(
        this,
        getClient(this).removeSubscription(id, kind, idempotency),
      );
    }),
    {
      mapsTo: 'DELETE /v1/contacts/:id/subscriptions/:kind',
      examples: [
        'cavuno contacts remove-subscription boardUsers_01EXAMPLE marketing --yes',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        contacts
          .command('remove-job-alert')
          .description(
            'Delete one of a contact’s job alerts. Their other alerts keep sending. This cannot be undone.',
          )
          .argument('<id>', 'Contact ID')
          .argument('<alertId>', 'Job alert ID'),
      ),
    ).action(async function (this: Command, id: string, alertId: string) {
      await confirmOrAbort({
        message: `Delete job alert ${alertId} for contact ${id}?`,
        yes: this.opts<ConfirmOptions>().yes,
      });
      const idempotency = resolveIdempotency(this.opts<IdempotencyOptions>());
      await run(this, getClient(this).removeJobAlert(id, alertId, idempotency));
    }),
    {
      mapsTo: 'DELETE /v1/contacts/:id/job-alerts/:alertId',
      examples: [
        'cavuno contacts remove-job-alert boardUsers_01EXAMPLE jobAlerts_01EXAMPLE --yes',
      ],
    },
  );
}
