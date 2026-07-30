import { buildManifest } from '../src/lib/manifest.js';
import { PUBLIC_GROUPS, createCliProgram } from '../src/program.js';

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

const program = createCliProgram(pkg.version);

const manifest = buildManifest(program, { groups: PUBLIC_GROUPS });
const outPath = resolve(here, '..', 'manifest.json');
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(
  `Wrote ${manifest.groups.length} groups, ` +
    `${manifest.groups.reduce((n, g) => n + g.commands.length, 0)} commands ` +
    `→ ${outPath}`,
);

// Release lineage: 1.1.0 renames the blog cover/OG flags to --cover-media-id and
// --og-image-media-id (old --*-storage-id names removed) and adds the
// company_not_backfillable error code. No other published-surface change.
