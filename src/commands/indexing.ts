import { Command } from 'commander';

import { createIndexingClient } from '../api/indexing.js';

import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
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
  return createIndexingClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

export function registerIndexingCommand(root: Command): void {
  const indexing = root
    .command('indexing')
    .description('Google Indexing configuration and the IndexNow toggle.');

  annotate(
    indexing
      .command('config')
      .description('Show the indexing + IndexNow configuration.')
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).getConfig());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/integrations/indexing',
      examples: ['cavuno indexing config'],
    },
  );

  annotate(
    withIdempotencyOption(
      indexing
        .command('enable-indexnow')
        .description('Enable IndexNow (Bing/Yandex instant indexing).'),
    ).action(async function (this: Command) {
      const r = unwrap(
        await getClient(this).toggleIndexNow(
          true,
          resolveIdempotency(this.opts<IdempotencyOptions>()),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/integrations/indexing/toggle-indexnow',
      examples: ['cavuno indexing enable-indexnow'],
    },
  );

  annotate(
    withIdempotencyOption(
      indexing.command('disable-indexnow').description('Disable IndexNow.'),
    ).action(async function (this: Command) {
      const r = unwrap(
        await getClient(this).toggleIndexNow(
          false,
          resolveIdempotency(this.opts<IdempotencyOptions>()),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/integrations/indexing/toggle-indexnow',
      examples: ['cavuno indexing disable-indexnow'],
    },
  );
}
