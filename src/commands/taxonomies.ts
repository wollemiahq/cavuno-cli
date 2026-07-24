import { Command } from 'commander';

import { createTaxonomiesClient } from '../api/taxonomies.js';

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
  return createTaxonomiesClient({
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

const toRows = (d: unknown) =>
  (d as { data: unknown[] }).data as Array<Record<string, unknown>>;

function parseLimit(flag: string) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      console.error(`${flag}: expected integer 1-100, got ${raw}`);
      process.exit(2);
    }
    return n;
  };
}

const csv = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function registerTaxonomiesCommand(root: Command): void {
  const taxonomies = root
    .command('taxonomies')
    .description(
      'Manage taxonomy skills, categories, and markets; list remote permits/timezones.',
    );

  // ── Public helpers ──
  annotate(
    taxonomies
      .command('remote-permits')
      .description('List remote-work permit options.')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.remotePermits();
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/taxonomies/remote-permits',
      examples: ['cavuno taxonomies remote-permits'],
    },
  );

  annotate(
    taxonomies
      .command('remote-timezones')
      .description('List remote-work timezone options.')
      .action(async function (this: Command) {
        const client = getClient(this);
        const format = getFormat(this);
        const r = await client.remoteTimezones();
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: 'GET /v1/taxonomies/remote-timezones',
      examples: ['cavuno taxonomies remote-timezones'],
    },
  );

  registerAxisCommands(taxonomies, 'skills', {
    mapsToBase: '/v1/taxonomies/skills',
    list: (c, q) => c.skillsList(q),
    get: (c, id) => c.skillsGet(id),
    create: (c, body) => c.skillsCreate(body),
    update: (c, id, body) => c.skillsUpdate(id, body),
    remove: (c, id) => c.skillsDelete(id),
    addAliases: (c, id, aliases) => c.skillsAddAliases(id, { aliases }),
    removeAlias: (c, id, alias) => c.skillsRemoveAlias(id, alias),
  });

  registerAxisCommands(taxonomies, 'categories', {
    mapsToBase: '/v1/taxonomies/categories',
    list: (c, q) => c.categoriesList(q),
    get: (c, id) => c.categoriesGet(id),
    create: (c, body) => c.categoriesCreate(body),
    update: (c, id, body) => c.categoriesUpdate(id, body),
    remove: (c, id) => c.categoriesDelete(id),
    addAliases: (c, id, aliases) => c.categoriesAddAliases(id, { aliases }),
    removeAlias: (c, id, alias) => c.categoriesRemoveAlias(id, alias),
    extra: (group, clientFn) => {
      annotate(
        group
          .command('tree')
          .description('List categories as a nested tree.')
          .action(async function (this: Command) {
            const client = clientFn(this);
            const format = getFormat(this);
            const r = await client.categoriesTree();
            if (r.error) throw fromApiError(r.error, r.response);
            print(r.data, format, toRows);
          }),
        {
          mapsTo: 'GET /v1/taxonomies/categories/tree',
          examples: ['cavuno taxonomies categories tree'],
        },
      );
    },
    createOptions: (cmd) =>
      cmd.option('--parent-id <id>', 'Parent category id'),
    updateOptions: (cmd) =>
      cmd
        .option('--parent-id <id>', 'Parent category id')
        .option('--clear-parent', 'Clear parent (root)'),
    buildCreateBody: (opts) => {
      const body: Record<string, unknown> = baseCreateBody(opts);
      if (opts.parentId) body.parentId = opts.parentId;
      return body;
    },
    buildUpdateBody: (opts) => {
      const body: Record<string, unknown> = baseUpdateBody(opts);
      if (opts.clearParent) body.parentId = null;
      else if (opts.parentId) body.parentId = opts.parentId;
      return body;
    },
  });

  registerAxisCommands(taxonomies, 'markets', {
    mapsToBase: '/v1/taxonomies/markets',
    list: (c, q) => c.marketsList(q),
    get: (c, id) => c.marketsGet(id),
    create: (c, body) => c.marketsCreate(body),
    update: (c, id, body) => c.marketsUpdate(id, body),
    remove: (c, id) => c.marketsDelete(id),
    addAliases: (c, id, aliases) => c.marketsAddAliases(id, { aliases }),
    removeAlias: (c, id, alias) => c.marketsRemoveAlias(id, alias),
  });
}

type TaxClient = ReturnType<typeof createTaxonomiesClient>;
type ApiR = {
  data?: unknown;
  error?: unknown;
  response: Response;
};

type AxisOpts = {
  mapsToBase: string;
  list: (c: TaxClient, q: Record<string, unknown>) => Promise<ApiR>;
  get: (c: TaxClient, id: string) => Promise<ApiR>;
  create: (c: TaxClient, body: Record<string, unknown>) => Promise<ApiR>;
  update: (
    c: TaxClient,
    id: string,
    body: Record<string, unknown>,
  ) => Promise<ApiR>;
  remove: (c: TaxClient, id: string) => Promise<ApiR>;
  addAliases: (
    c: TaxClient,
    id: string,
    aliases: string[],
  ) => Promise<ApiR>;
  removeAlias: (c: TaxClient, id: string, alias: string) => Promise<ApiR>;
  extra?: (
    group: Command,
    clientFn: (cmd: Command) => TaxClient,
  ) => void;
  createOptions?: (cmd: Command) => Command;
  updateOptions?: (cmd: Command) => Command;
  buildCreateBody?: (opts: Record<string, unknown>) => Record<string, unknown>;
  buildUpdateBody?: (opts: Record<string, unknown>) => Record<string, unknown>;
};

function baseCreateBody(opts: Record<string, unknown>) {
  const body: Record<string, unknown> = { name: opts.name };
  if (opts.slug) body.slug = opts.slug;
  if (opts.sourceLocale) body.sourceLocale = opts.sourceLocale;
  if (typeof opts.aliasSlugs === 'string' && opts.aliasSlugs) {
    body.aliasSlugs = csv(opts.aliasSlugs);
  }
  return body;
}

function baseUpdateBody(opts: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  if (opts.name) body.name = opts.name;
  if (opts.slug) body.slug = opts.slug;
  if (opts.sourceLocale) body.sourceLocale = opts.sourceLocale;
  return body;
}

function registerAxisCommands(
  taxonomies: Command,
  name: string,
  axis: AxisOpts,
) {
  const group = taxonomies
    .command(name)
    .description(`Manage taxonomy ${name}.`);

  const clientFn = (cmd: Command) => getClient(cmd);

  if (axis.extra) axis.extra(group, clientFn);

  annotate(
    group
      .command('list')
      .description(`List ${name}.`)
      .option('--limit <n>', 'Page size 1-100', parseLimit('--limit'))
      .option('--cursor <cursor>', 'Pagination cursor')
      .option('--search <q>', 'Search name/slug')
      .action(async function (this: Command) {
        const client = clientFn(this);
        const format = getFormat(this);
        const opts = this.opts<{
          limit?: number;
          cursor?: string;
          search?: string;
        }>();
        const r = await axis.list(client, {
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          ...(opts.cursor ? { cursor: opts.cursor } : {}),
          ...(opts.search ? { search: opts.search } : {}),
        });
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format, toRows);
      }),
    {
      mapsTo: `GET ${axis.mapsToBase}`,
      examples: [`cavuno taxonomies ${name} list`],
    },
  );

  annotate(
    group
      .command('get')
      .description(`Get a ${name.slice(0, -1)} by id.`)
      .argument('<id>', 'Opaque object id')
      .action(async function (this: Command, id: string) {
        const client = clientFn(this);
        const format = getFormat(this);
        const r = await axis.get(client, id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: `GET ${axis.mapsToBase}/:id`,
      examples: [`cavuno taxonomies ${name} get <id>`],
    },
  );

  let createCmd = group
    .command('create')
    .description(`Create a ${name.slice(0, -1)}.`)
    .requiredOption('--name <name>', 'Display name')
    .option('--slug <slug>', 'Canonical slug (default: from name)')
    .option('--source-locale <locale>', 'Source locale')
    .option('--alias-slugs <slugs>', 'Comma-separated initial aliases');
  if (axis.createOptions) createCmd = axis.createOptions(createCmd);

  annotate(
    createCmd.action(async function (this: Command) {
      const client = clientFn(this);
      const format = getFormat(this);
      const opts = this.opts<Record<string, unknown>>();
      const body = axis.buildCreateBody
        ? axis.buildCreateBody(opts)
        : baseCreateBody(opts);
      const r = await axis.create(client, body);
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: `POST ${axis.mapsToBase}`,
      examples: [
        `cavuno taxonomies ${name} create --name "Example" --slug example`,
      ],
    },
  );

  let updateCmd = group
    .command('update')
    .description(`Update a ${name.slice(0, -1)}.`)
    .argument('<id>', 'Opaque object id')
    .option('--name <name>', 'Display name')
    .option('--slug <slug>', 'Canonical slug')
    .option('--source-locale <locale>', 'Source locale');
  if (axis.updateOptions) updateCmd = axis.updateOptions(updateCmd);

  annotate(
    updateCmd.action(async function (this: Command, id: string) {
      const client = clientFn(this);
      const format = getFormat(this);
      const opts = this.opts<Record<string, unknown>>();
      const body = axis.buildUpdateBody
        ? axis.buildUpdateBody(opts)
        : baseUpdateBody(opts);
      if (Object.keys(body).length === 0) {
        console.error('Provide at least one field to update');
        process.exit(2);
      }
      const r = await axis.update(client, id, body);
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, format);
    }),
    {
      mapsTo: `PATCH ${axis.mapsToBase}/:id`,
      examples: [`cavuno taxonomies ${name} update <id> --name "New name"`],
    },
  );

  annotate(
    group
      .command('delete')
      .description(`Delete a ${name.slice(0, -1)}.`)
      .argument('<id>', 'Opaque object id')
      .action(async function (this: Command, id: string) {
        const client = clientFn(this);
        const format = getFormat(this);
        const r = await axis.remove(client, id);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data ?? { deleted: true, id }, format);
      }),
    {
      mapsTo: `DELETE ${axis.mapsToBase}/:id`,
      examples: [`cavuno taxonomies ${name} delete <id>`],
    },
  );

  annotate(
    group
      .command('add-alias')
      .description(`Add aliases to a ${name.slice(0, -1)} (dual-write).`)
      .argument('<id>', 'Opaque object id')
      .requiredOption(
        '--alias <aliases>',
        'Alias slug or comma-separated list',
      )
      .action(async function (this: Command, id: string) {
        const client = clientFn(this);
        const format = getFormat(this);
        const opts = this.opts<{ alias: string }>();
        const aliases = csv(opts.alias);
        const r = await axis.addAliases(client, id, aliases);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, format);
      }),
    {
      mapsTo: `POST ${axis.mapsToBase}/:id/aliases`,
      examples: [`cavuno taxonomies ${name} add-alias <id> --alias other-slug`],
    },
  );

  annotate(
    group
      .command('remove-alias')
      .description(`Remove an alias from a ${name.slice(0, -1)}.`)
      .argument('<id>', 'Opaque object id')
      .argument('<alias>', 'Alias slug to remove')
      .action(async function (this: Command, id: string, alias: string) {
        const client = clientFn(this);
        const format = getFormat(this);
        const r = await axis.removeAlias(client, id, alias);
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data ?? { removed: true, id, alias }, format);
      }),
    {
      mapsTo: `DELETE ${axis.mapsToBase}/:id/aliases/:alias`,
      examples: [`cavuno taxonomies ${name} remove-alias <id> other-slug`],
    },
  );
}
