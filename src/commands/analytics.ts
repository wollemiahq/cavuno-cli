import { Command } from 'commander';

import { createAnalyticsClient } from '../api/analytics.js';

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
  return createAnalyticsClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

export function registerAnalyticsCommand(root: Command): void {
  const analytics = root
    .command('analytics')
    .description(
      'Typed Board homepage analytics (overview metrics and traffic tables).',
    );

  annotate(
    analytics
      .command('overview')
      .description(
        'Show homepage-shaped analytics overview metrics for the Board.',
      )
      .option('--start <date>', 'Inclusive range start (YYYY-MM-DD, UTC)')
      .option('--end <date>', 'Inclusive range end (YYYY-MM-DD, UTC)')
      .action(async function (this: Command) {
        const opts = this.opts<{ start?: string; end?: string }>();
        const { data, error, response } = await getClient(this).getOverview({
          start: opts.start,
          end: opts.end,
        });
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/analytics/overview',
      examples: [
        'cavuno analytics overview',
        'cavuno analytics overview --start 2026-01-01 --end 2026-01-30',
      ],
    },
  );

  annotate(
    analytics
      .command('traffic')
      .description(
        'Show homepage-shaped traffic tables (pages, sources, locations, devices).',
      )
      .option('--start <date>', 'Inclusive range start (YYYY-MM-DD, UTC)')
      .option('--end <date>', 'Inclusive range end (YYYY-MM-DD, UTC)')
      .option('--limit <n>', 'Max rows per table (1–10)', (v) => Number(v))
      .action(async function (this: Command) {
        const opts = this.opts<{
          start?: string;
          end?: string;
          limit?: number;
        }>();
        const { data, error, response } = await getClient(this).getTraffic({
          start: opts.start,
          end: opts.end,
          limit: opts.limit,
        });
        if (error) throw fromApiError(error, response);
        print(data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/analytics/traffic',
      examples: [
        'cavuno analytics traffic',
        'cavuno analytics traffic --start 2026-01-01 --end 2026-01-30 --limit 5',
      ],
    },
  );
}
