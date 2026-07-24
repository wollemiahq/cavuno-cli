import { Command } from 'commander';

import { createCandidatesClient } from '../api/candidates.js';

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
import { printOrWait, type WaitOptions, withWaitOption } from '../lib/wait.js';

import { writeFile } from 'node:fs/promises';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createCandidatesClient({
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

export function registerCandidatesCommand(root: Command): void {
  const candidates = root
    .command('candidates')
    .description('Manage candidates in the authenticated account.');

  annotate(
    candidates
      .command('list')
      .description('List candidates (paginated).')
      .option('--search <query>', 'Substring search on email / display name')
      .option('--handle <handle>', 'Exact profile handle lookup')
      .option('--has-resume', 'Only candidates with a resume on file')
      .option('--created-from <iso>', 'Filter to candidates created on/after')
      .option('--created-to <iso>', 'Filter to candidates created on/before')
      .option('--limit <n>', 'Page size 1-100 (default 50)', (v) =>
        parseInt(v, 10),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{
          search?: string;
          handle?: string;
          hasResume?: boolean;
          createdFrom?: string;
          createdTo?: string;
          limit?: number;
          cursor?: string;
        }>();
        const r = unwrap(
          await client.list({
            ...(opts.search !== undefined && { search: opts.search }),
            ...(opts.handle !== undefined && { handle: opts.handle }),
            ...(opts.hasResume !== undefined && { hasResume: opts.hasResume }),
            ...(opts.createdFrom !== undefined && {
              createdFrom: opts.createdFrom,
            }),
            ...(opts.createdTo !== undefined && { createdTo: opts.createdTo }),
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.cursor !== undefined && { cursor: opts.cursor }),
          }),
        );
        if (r.error) throw fromApiError(r.error, r.response);
        print(
          r.data,
          format,
          (d) =>
            (d as { data: unknown[] }).data as Array<Record<string, unknown>>,
        );
      }),
    {
      mapsTo: 'GET /v1/candidates',
      examples: [
        'cavuno candidates list',
        'cavuno candidates list --search alice --has-resume --limit 10',
      ],
    },
  );

  annotate(
    candidates
      .command('resume')
      .description('Download a candidate resume through the protected API.')
      .argument('<id>', 'Candidate ID')
      .requiredOption('--output <path>', 'File path to write')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const opts = this.opts<{ output: string }>();
        const r = unwrap(await client.downloadResume(id));
        if (r.error) throw fromApiError(r.error, r.response);
        const bytes = Buffer.from(r.data as ArrayBuffer);
        await writeFile(opts.output, bytes);
        print(
          {
            object: 'candidate_resume',
            candidateId: id,
            output: opts.output,
            sizeBytes: bytes.byteLength,
          },
          format,
        );
      }),
    {
      mapsTo: 'GET /v1/candidates/:id/resume',
      examples: [
        'cavuno candidates resume nh7abc... --output ./candidate-resume.pdf',
      ],
    },
  );

  annotate(
    candidates
      .command('get')
      .description('Fetch a single candidate by ID (with profile + counts).')
      .argument('<id>', 'Candidate ID')
      .action(async function (this: Command, id: string) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = unwrap(await client.get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/candidates/:id',
      examples: ['cavuno candidates get nh7abc...'],
    },
  );

  annotate(
    withWaitOption(
      withYesOption(
        withIdempotencyOption(
          candidates
            .command('delete')
            .description(
              'Permanently erase a candidate and all associated data (GDPR cascade). Returns a candidates.remove operation to poll.',
            )
            .argument('<id>', 'Candidate ID'),
        ),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & ConfirmOptions & WaitOptions
      >();
      await confirmOrAbort({
        message: `Permanently erase candidate ${id} and all associated data (GDPR cascade)?`,
        yes: opts.yes,
      });
      const client = getClient(this);
      const r = unwrap(await client.remove(id, resolveIdempotency(opts)));
      if (r.error) throw fromApiError(r.error, r.response);
      await printOrWait(this, r, opts);
    }),
    {
      mapsTo: 'DELETE /v1/candidates/:id',
      examples: [
        'cavuno candidates delete nh7abc... --yes',
        'cavuno candidates delete nh7abc... --yes --wait',
      ],
    },
  );
}
