import { CliError } from './lib/auth.js';
import { createCliProgram } from './program.js';

import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const program = createCliProgram(packageJson.version);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    // Network errors get a friendly one-liner instead of a raw stack.
    if (
      err instanceof Error &&
      (err.message.includes('fetch failed') ||
        (err as NodeJS.ErrnoException).code === 'ECONNREFUSED')
    ) {
      console.error(
        '✗ network_error\n  Could not reach the API at the configured URL. ' +
          'Check $CAVUNO_API_URL or --api-url.',
      );
      process.exit(11);
    }
    // Unexpected — surface fully and exit 10.
    console.error(err);
    process.exit(10);
  }
}

void main();
