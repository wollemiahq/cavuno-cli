import { Command } from 'commander';

import {
  createDistributionClient,
  type CreateDistributionFeedBody,
  type UpdateDistributionFeedBody,
} from '../api/distribution.js';
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

const TEMPLATES = [
  'indeed',
  'jooble',
  'careerjet',
  'jora',
  'jobrapido',
  'custom',
] as const;
type Template = (typeof TEMPLATES)[number];
type SourceRule = 'own' | 'all';

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createDistributionClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  return opts.format ?? 'json';
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

function newIdempotencyKey(): string {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const listExtractor = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

function parseTemplate(raw: string): Template {
  if (!(TEMPLATES as readonly string[]).includes(raw)) {
    console.error(`--template: expected one of ${TEMPLATES.join(', ')}`);
    process.exit(2);
  }
  return raw as Template;
}

function parseSourceRule(raw: string): SourceRule {
  if (raw !== 'own' && raw !== 'all') {
    console.error('--source-rule: expected own or all');
    process.exit(2);
  }
  return raw;
}

/**
 * Commander turns a parser's `null` into `''`, so a JSON `null` (clear, on
 * update) travels as this marker and becomes `null` in the request body.
 */
const CLEAR = Symbol('clear');

function orNull<T>(value: T | typeof CLEAR): T | null {
  return value === CLEAR ? null : value;
}

/** A JSON object, or `null` to clear (update only). */
function parseJsonObject(flag: string) {
  return (raw: string): Record<string, unknown> | typeof CLEAR => {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      console.error(`${flag}: expected a JSON object`);
      process.exit(2);
    }
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
      console.error(`${flag}: expected a JSON object`);
      process.exit(2);
    }
    return value === null ? CLEAR : (value as Record<string, unknown>);
  };
}

function parseOnOff(raw: string): boolean {
  if (raw !== 'on' && raw !== 'off') {
    console.error('--cavuno-distribution: expected on or off');
    process.exit(2);
  }
  return raw === 'on';
}

interface FeedOpts {
  name?: string;
  template?: Template;
  sourceRule?: SourceRule;
  filter?: Record<string, unknown> | typeof CLEAR;
  customFieldNames?: Record<string, unknown> | typeof CLEAR;
  contactEmail?: string;
  clearContactEmail?: boolean;
}

function withFeedOptions(command: Command): Command {
  return command
    .option(
      '--source-rule <rule>',
      'own (board jobs only) or all (Backfill included)',
      parseSourceRule,
    )
    .option(
      '--filter <json>',
      'Job filter, e.g. \'{"remoteOptions":["remote"],"featuredOnly":true}\'',
      parseJsonObject('--filter'),
    )
    .option(
      '--custom-field-names <json>',
      'custom template only: element renames, e.g. \'{"title":"jobtitle"}\'',
      parseJsonObject('--custom-field-names'),
    )
    .option('--contact-email <email>', 'indeed template only: <email> value');
}

export function registerDistributionCommand(root: Command): void {
  const distribution = root
    .command('distribution')
    .description(
      'Publish jobs to job aggregators with XML feeds, and manage the Cavuno distribution opt-in.',
    );

  const feeds = distribution
    .command('feeds')
    .description('Manage XML feeds of your published jobs.');

  annotate(
    feeds
      .command('list')
      .description(
        'List XML feeds: one prebuilt feed per aggregator, then custom feeds.',
      )
      .action(async function (this: Command) {
        const client = getClient(this);
        const r = unwrap(await client.listFeeds());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listExtractor);
      }),
    {
      mapsTo: 'GET /v1/distribution/feeds',
      examples: ['cavuno distribution feeds list --format table'],
    },
  );

  annotate(
    feeds
      .command('get')
      .description('Show one XML feed.')
      .argument('<id>', 'Feed ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const r = unwrap(await client.getFeed(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/distribution/feeds/:id',
      examples: ['cavuno distribution feeds get k17abc'],
    },
  );

  annotate(
    withFeedOptions(
      feeds
        .command('create')
        .description('Create a custom XML feed.')
        .argument('<name>', 'Feed name; its URL slug is derived from it')
        .requiredOption(
          '--template <template>',
          `XML format: ${TEMPLATES.join(', ')}`,
          parseTemplate,
        ),
    ).action(async function (this: Command, name: string) {
      const client = getClient(this);
      const opts = this.opts<FeedOpts>();
      const body: CreateDistributionFeedBody = {
        name,
        template: opts.template!,
      };
      if (opts.sourceRule) body.sourceRule = opts.sourceRule;
      const filter = opts.filter === undefined ? null : orNull(opts.filter);
      if (filter) body.filter = filter as never;
      const customFieldNames =
        opts.customFieldNames === undefined
          ? null
          : orNull(opts.customFieldNames);
      if (customFieldNames) body.customFieldNames = customFieldNames as never;
      if (opts.contactEmail !== undefined) {
        body.contactEmail = opts.contactEmail;
      }
      const r = unwrap(
        await client.createFeed(body, { idempotencyKey: newIdempotencyKey() }),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/distribution/feeds',
      examples: [
        'cavuno distribution feeds create "Remote jobs" --template jooble --filter \'{"remoteOptions":["remote"]}\'',
        'cavuno distribution feeds create "Partner feed" --template custom --custom-field-names \'{"title":"jobtitle"}\'',
      ],
    },
  );

  annotate(
    withFeedOptions(
      feeds
        .command('update')
        .description(
          'Update an XML feed. Omitted options are unchanged; pass null to --filter or --custom-field-names to clear.',
        )
        .argument('<id>', 'Feed ID')
        .option('--name <name>', 'New name (the URL never changes)')
        .option(
          '--template <template>',
          `XML format: ${TEMPLATES.join(', ')}`,
          parseTemplate,
        ),
    )
      .option('--clear-contact-email', 'Remove the indeed contact email')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const opts = this.opts<FeedOpts>();
        const body: UpdateDistributionFeedBody = {};
        if (opts.name !== undefined) body.name = opts.name;
        if (opts.template) body.template = opts.template;
        if (opts.sourceRule) body.sourceRule = opts.sourceRule;
        if (opts.filter !== undefined) {
          body.filter = orNull(opts.filter) as never;
        }
        if (opts.customFieldNames !== undefined) {
          body.customFieldNames = orNull(opts.customFieldNames) as never;
        }
        if (opts.clearContactEmail) body.contactEmail = null;
        else if (opts.contactEmail !== undefined) {
          body.contactEmail = opts.contactEmail;
        }
        const r = unwrap(
          await client.updateFeed(id, body, {
            idempotencyKey: newIdempotencyKey(),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PATCH /v1/distribution/feeds/:id',
      examples: [
        'cavuno distribution feeds update k17abc --contact-email jobs@example.com',
        'cavuno distribution feeds update k17abc --filter null',
      ],
    },
  );

  annotate(
    withYesOption(
      feeds
        .command('remove')
        .description('Delete a custom XML feed; its URL stops working.')
        .argument('<id>', 'Feed ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({ message: `Delete feed ${id}?`, yes: opts.yes });
      const client = getClient(this);
      const r = unwrap(
        await client.removeFeed(id, { idempotencyKey: newIdempotencyKey() }),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/distribution/feeds/:id',
      examples: ['cavuno distribution feeds remove k17abc --yes'],
    },
  );

  const origin = distribution
    .command('origin')
    .description('Where feed URLs live, and whether they moved.');

  annotate(
    origin
      .command('get')
      .description('Show the feed origin and any moved origins.')
      .action(async function (this: Command) {
        const client = getClient(this);
        const r = unwrap(await client.getFeedOrigin());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/distribution/feed-origin',
      examples: ['cavuno distribution origin get'],
    },
  );

  annotate(
    origin
      .command('acknowledge')
      .description('Mark moved feed URLs as resubmitted to the aggregators.')
      .action(async function (this: Command) {
        const client = getClient(this);
        const r = unwrap(
          await client.acknowledgeFeedOrigin({
            idempotencyKey: newIdempotencyKey(),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'POST /v1/distribution/feed-origin/acknowledge',
      examples: ['cavuno distribution origin acknowledge'],
    },
  );

  const settings = distribution
    .command('settings')
    .description('The Cavuno distribution opt-in.');

  annotate(
    settings
      .command('get')
      .description('Show distribution settings.')
      .action(async function (this: Command) {
        const client = getClient(this);
        const r = unwrap(await client.getSettings());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/distribution/settings',
      examples: ['cavuno distribution settings get'],
    },
  );

  annotate(
    settings
      .command('update')
      .description('Switch Cavuno distribution on or off.')
      .requiredOption('--cavuno-distribution <on|off>', 'on or off', parseOnOff)
      .action(async function (this: Command) {
        const client = getClient(this);
        const opts = this.opts<{ cavunoDistribution: boolean }>();
        const r = unwrap(
          await client.updateSettings(
            { cavunoDistributionEnabled: opts.cavunoDistribution },
            { idempotencyKey: newIdempotencyKey() },
          ),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'PATCH /v1/distribution/settings',
      examples: [
        'cavuno distribution settings update --cavuno-distribution off',
      ],
    },
  );
}
