import { describe, expect, it } from 'vitest';

import { buildManifest } from '../lib/manifest.js';
import { PUBLIC_GROUPS, createCliProgram } from '../program.js';

import type { CliManifest } from '../lib/manifest.js';
import { readFileSync } from 'node:fs';

const checkedInManifest = JSON.parse(
  readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'),
) as CliManifest;
const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe('checked-in CLI manifest', () => {
  it('uses the canonical public description', () => {
    expect(createCliProgram(packageJson.version).description()).toBe(
      'Manage your Cavuno job board from the command line.',
    );
  });

  it('exactly matches the complete generated public CLI structure', () => {
    const program = createCliProgram(packageJson.version);
    expect(program.commands.map((command) => command.name()).sort()).toEqual(
      [...PUBLIC_GROUPS].sort(),
    );

    const generated = buildManifest(program, {
      groups: PUBLIC_GROUPS,
      generatedAt: checkedInManifest.generatedAt,
    });

    expect(checkedInManifest).toEqual(generated);
  });
});
