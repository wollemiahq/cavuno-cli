import { CliError } from './auth.js';

import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';

export interface ConfirmOptions {
  yes?: boolean;
}

export function withYesOption<T extends Command>(command: T): T {
  command.option('-y, --yes', 'Skip the confirmation prompt');
  return command;
}

export async function confirmOrAbort({
  message,
  yes,
}: {
  message: string;
  yes?: boolean;
}): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(
      'This command is destructive. Pass --yes to run it non-interactively.',
      2,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${message} (y/N) `))
      .trim()
      .toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      throw new CliError('Aborted.', 2);
    }
  } finally {
    rl.close();
  }
}
