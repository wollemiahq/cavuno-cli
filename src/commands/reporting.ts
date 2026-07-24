import { Command } from 'commander';

import {
  createReportingClient,
  type ReportingProvider,
} from '../api/reporting.js';

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
  return createReportingClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
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

const listExtractor = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

export function registerReportingCommand(root: Command): void {
  const reporting = root
    .command('reporting')
    .description('Manage reporting integrations.');

  annotate(
    reporting
      .command('integrations')
      .description('List the reporting integrations for the account.')
      .action(async function (this: Command) {
        const r = unwrap(await getClient(this).listIntegrations());
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this), listExtractor);
      }),
    {
      mapsTo: 'GET /v1/integrations/reporting',
      examples: ['cavuno reporting integrations'],
    },
  );

  annotate(
    reporting
      .command('get')
      .description('Fetch one reporting integration by provider.')
      .argument('<provider>', 'search_console | adsense | tinybird | stripe')
      .action(async function (this: Command, provider: ReportingProvider) {
        const r = unwrap(await getClient(this).getIntegration(provider));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/integrations/reporting/:provider',
      examples: ['cavuno reporting get search_console'],
    },
  );

  annotate(
    withIdempotencyOption(
      reporting
        .command('connect')
        .description(
          'Start the connect flow for a provider (returns an OAuth URL / redirect).',
        )
        .argument('<provider>', 'search_console | adsense | tinybird | stripe'),
    ).action(async function (this: Command, provider: ReportingProvider) {
      const r = unwrap(
        await getClient(this).connect(
          provider,
          resolveIdempotency(this.opts<IdempotencyOptions>()),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/integrations/reporting/:provider/connect',
      examples: ['cavuno reporting connect search_console'],
    },
  );

  annotate(
    withIdempotencyOption(
      reporting
        .command('enable')
        .description('Enable collection for an existing integration.')
        .argument('<provider>', 'The provider to enable'),
    ).action(async function (this: Command, provider: ReportingProvider) {
      const r = unwrap(
        await getClient(this).setEnabled(
          provider,
          true,
          resolveIdempotency(this.opts<IdempotencyOptions>()),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/integrations/reporting/:provider',
      examples: ['cavuno reporting enable adsense'],
    },
  );

  annotate(
    withIdempotencyOption(
      reporting
        .command('disable')
        .description('Pause collection for an existing integration.')
        .argument('<provider>', 'The provider to disable'),
    ).action(async function (this: Command, provider: ReportingProvider) {
      const r = unwrap(
        await getClient(this).setEnabled(
          provider,
          false,
          resolveIdempotency(this.opts<IdempotencyOptions>()),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/integrations/reporting/:provider',
      examples: ['cavuno reporting disable adsense'],
    },
  );

  annotate(
    withYesOption(
      withIdempotencyOption(
        reporting
          .command('disconnect')
          .description('Disconnect an integration (delete the row).')
          .argument('<provider>', 'The provider to disconnect'),
      ),
    ).action(async function (this: Command, provider: ReportingProvider) {
      const opts = this.opts<IdempotencyOptions & ConfirmOptions>();
      await confirmOrAbort({
        message: `Disconnect the ${provider} reporting integration and delete its row?`,
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).disconnect(provider, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'DELETE /v1/integrations/reporting/:provider',
      examples: ['cavuno reporting disconnect adsense --yes'],
    },
  );
}
