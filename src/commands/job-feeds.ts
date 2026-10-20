import { Command } from 'commander';

import {
  type CreateJobFeedBody,
  type UpdateJobFeedBody,
  createJobFeedsClient,
} from '../api/job-feeds.js';
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

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createJobFeedsClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function parseIntRange(flag: string, min: number, max: number) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      fail(`${flag}: expected an integer from ${min} to ${max}, got ${raw}`);
    }
    return n;
  };
}

const INTERVALS = [1, 3, 6, 12, 24] as const;
type IntervalHours = (typeof INTERVALS)[number];

function parseInterval(raw: string): IntervalHours {
  const n = Number(raw);
  if (!(INTERVALS as readonly number[]).includes(n)) {
    fail(
      `--interval-hours: expected one of ${INTERVALS.join(', ')}, got ${raw}`,
    );
  }
  return n as IntervalHours;
}

function parseBool(flag: string) {
  return (raw: string): boolean => {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    fail(`${flag}: expected true or false, got ${raw}`);
  };
}

/** `none` clears the per-feed cap (Commander drops a `null` parser result). */
function parseJobLimit(raw: string): number | 'none' {
  if (raw === 'none') return 'none';
  return parseIntRange('--job-limit', 1, 100_000)(raw);
}

function jobLimitField(jobLimit: number | 'none' | undefined) {
  if (jobLimit === undefined) return {};
  return { jobLimit: jobLimit === 'none' ? null : jobLimit };
}

function parseJson(flag: string) {
  return (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      fail(`${flag}: value is not valid JSON`);
    }
  };
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

const listExtractor = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

export function registerJobFeedsCommand(root: Command): void {
  const feeds = root
    .command('job-feeds')
    .description(
      'Recurring XML job feeds pulled from a URL on a schedule (connect, map, re-detect, runs).',
    );

  annotate(
    feeds
      .command('list')
      .description('List job feeds (paginated, oldest first).')
      .option(
        '--limit <n>',
        'Page size 1-50 (default 50)',
        parseIntRange('--limit', 1, 50),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const opts = this.opts<{ limit?: number; cursor?: string }>();
        const r = unwrap(
          await getClient(this).list({
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listExtractor);
      }),
    {
      mapsTo: 'GET /v1/job-feeds',
      examples: ['cavuno job-feeds list'],
    },
  );

  annotate(
    feeds
      .command('get')
      .description(
        'Fetch one job feed (schedule, last run, mapping review state).',
      )
      .argument('<id>', 'Job feed ID')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/job-feeds/:id',
      examples: ['cavuno job-feeds get k17feed'],
    },
  );

  annotate(
    withIdempotencyOption(
      feeds
        .command('create')
        .description(
          'Connect an XML feed URL. The URL is checked before it is saved; the first run detects the mapping.',
        )
        .requiredOption('--url <url>', 'The XML feed URL')
        .option('--name <name>', 'Display name (defaults from the URL host)')
        .option(
          '--interval-hours <hours>',
          'Hours between pulls: 1, 3, 6, 12 or 24 (default 6)',
          parseInterval,
        )
        .option(
          '--expire-missing <bool>',
          'Expire jobs missing from two runs in a row (default true)',
          parseBool('--expire-missing'),
        )
        .option(
          '--job-limit <n|none>',
          'Most jobs this feed may publish at once',
          parseJobLimit,
        ),
    ).action(async function (this: Command) {
      const opts = this.opts<
        IdempotencyOptions & {
          url: string;
          name?: string;
          intervalHours?: IntervalHours;
          expireMissing?: boolean;
          jobLimit?: number | 'none';
        }
      >();
      const body: CreateJobFeedBody = {
        url: opts.url,
        ...(opts.name !== undefined && { name: opts.name }),
        ...(opts.intervalHours !== undefined && {
          intervalHours: opts.intervalHours,
        }),
        ...(opts.expireMissing !== undefined && {
          expireMissing: opts.expireMissing,
        }),
        ...jobLimitField(opts.jobLimit),
      } as CreateJobFeedBody;
      const r = unwrap(
        await getClient(this).create(body, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/job-feeds',
      examples: [
        'cavuno job-feeds create --url https://ats.example.com/jobs.xml',
        'cavuno job-feeds create --url https://ats.example.com/jobs.xml --interval-hours 12 --job-limit 500',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      feeds
        .command('update')
        .description(
          'Change the URL, name, schedule, enabled state, job limit, attribution or mapping.',
        )
        .argument('<id>', 'Job feed ID')
        .option('--url <url>', 'New feed URL (checked before it is saved)')
        .option('--name <name>', 'Display name')
        .option(
          '--interval-hours <hours>',
          'Hours between pulls: 1, 3, 6, 12 or 24',
          parseInterval,
        )
        .option(
          '--enabled <bool>',
          'Pull on schedule (true) or pause the feed (false)',
          parseBool('--enabled'),
        )
        .option(
          '--expire-missing <bool>',
          'Expire jobs missing from two runs in a row',
          parseBool('--expire-missing'),
        )
        .option(
          '--job-limit <n|none>',
          'Most jobs this feed may publish at once; none clears it',
          parseJobLimit,
        )
        .option(
          '--apply-url-attribution <json>',
          'e.g. {"mode":"inherit"}, {"mode":"off"} or {"mode":"append","params":[...]}',
          parseJson('--apply-url-attribution'),
        )
        .option(
          '--mapping <json>',
          'Replacement mapping: {"fieldMappings":[...],"valueTransforms":[...]}',
          parseJson('--mapping'),
        ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & {
          url?: string;
          name?: string;
          intervalHours?: IntervalHours;
          enabled?: boolean;
          expireMissing?: boolean;
          jobLimit?: number | 'none';
          applyUrlAttribution?: unknown;
          mapping?: unknown;
        }
      >();
      const { idempotencyKey, jobLimit, ...fields } = opts;
      const body = {
        ...Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined),
        ),
        ...jobLimitField(jobLimit),
      } as UpdateJobFeedBody;
      if (Object.keys(body).length === 0) {
        fail('job-feeds update: pass at least one field to change');
      }
      const r = unwrap(
        await getClient(this).update(
          id,
          body,
          resolveIdempotency({ idempotencyKey }),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/job-feeds/:id',
      examples: [
        'cavuno job-feeds update k17feed --enabled false',
        'cavuno job-feeds update k17feed --url https://ats.example.com/v2.xml --interval-hours 24',
      ],
    },
  );

  annotate(
    withYesOption(
      feeds
        .command('delete')
        .description(
          'Delete a job feed. Jobs it already published stay published.',
        )
        .argument('<id>', 'Job feed ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions>();
      await confirmOrAbort({
        message: `Delete job feed ${id}?`,
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).delete(id, resolveIdempotency({})),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/job-feeds/:id',
      examples: ['cavuno job-feeds delete k17feed --yes'],
    },
  );

  annotate(
    withIdempotencyOption(
      feeds
        .command('redetect-mapping')
        .description(
          'Discard the mapping and detect a fresh one on the next run, which starts now.',
        )
        .argument('<id>', 'Job feed ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).redetectMapping(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/job-feeds/:id/redetect-mapping',
      examples: ['cavuno job-feeds redetect-mapping k17feed'],
    },
  );

  annotate(
    feeds
      .command('runs')
      .description("List a job feed's runs (most recent first).")
      .argument('<id>', 'Job feed ID')
      .option(
        '--limit <n>',
        'Page size 1-50 (default 20)',
        parseIntRange('--limit', 1, 50),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ limit?: number; cursor?: string }>();
        const r = unwrap(
          await getClient(this).listRuns(id, {
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listExtractor);
      }),
    {
      mapsTo: 'GET /v1/job-feeds/:id/runs',
      examples: ['cavuno job-feeds runs k17feed --limit 5'],
    },
  );
}
