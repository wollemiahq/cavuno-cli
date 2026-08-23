import { Command } from 'commander';

import { createMediaClient, type MediaPurpose } from '../api/media.js';
import { resolveAuth } from '../lib/auth.js';
import { fromApiError } from '../lib/error.js';
import { print, type OutputFormat } from '../lib/output.js';

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

const PURPOSES: MediaPurpose[] = [
  'board_logo',
  'board_hero',
  'account_avatar',
  'company_logo',
  'blog_image',
];

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXTENSION)) {
    if (lower.endsWith(ext)) return mime;
  }
  return 'application/octet-stream';
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createMediaClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
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

export function registerMediaCommand(root: Command): void {
  const media = root
    .command('media')
    .description('Upload + fetch media (images) via the v1 dispatcher.');

  media
    .command('upload')
    .description(
      `Upload a file. Purpose must be one of: ${PURPOSES.join(', ')}.`,
    )
    .argument('<file>', 'Path to the local file to upload')
    .requiredOption('--purpose <purpose>', 'Upload purpose (see help)')
    .option(
      '--resource-id <id>',
      'Optional resource ID for purpose-bound uploads',
    )
    .option(
      '--account-id <id>',
      'Tenant account ID (defaults to api key tenant)',
    )
    .action(async function (this: Command, filePath: string) {
      const client = getClient(this);
      const format = getFormat(this);
      const opts = this.opts<{
        purpose: string;
        resourceId?: string;
        accountId?: string;
      }>();

      if (!PURPOSES.includes(opts.purpose as MediaPurpose)) {
        throw new Error(
          `Unknown purpose: ${opts.purpose}. Expected one of: ${PURPOSES.join(', ')}`,
        );
      }

      const buffer = await readFile(filePath);
      const mime = inferMimeFromPath(filePath);
      const file = new Blob([buffer], { type: mime });
      // Most fetch impls preserve the multipart filename when given a Blob;
      // including the basename keeps server logs readable.
      Object.defineProperty(file, 'name', {
        value: basename(filePath),
        configurable: true,
      });

      const r = unwrap(
        await client.upload({
          file,
          purpose: opts.purpose as MediaPurpose,
          ...(opts.resourceId && { resourceId: opts.resourceId }),
          ...(opts.accountId && { accountId: opts.accountId }),
        }),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    });

  media
    .command('get')
    .description('Fetch media metadata + a fresh signed URL by storage ID.')
    .argument('<id>', 'Storage ID')
    .option(
      '--account-id <id>',
      'Tenant account ID (defaults to api key tenant)',
    )
    .action(async function (this: Command, id: string) {
      const client = getClient(this);
      const format = getFormat(this);
      // The CLI's `--account` flag scopes every request through the
      // X-Cavuno-Account header; `accountId` is not a per-call query option.
      const r = unwrap(await client.get(id));
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    });
}
