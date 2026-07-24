import type { Command } from 'commander';

export interface IdempotencyOptions {
  idempotencyKey?: string;
}

export function withIdempotencyOption<T extends Command>(command: T): T {
  command.option(
    '--idempotency-key <key>',
    'Reuse this key when retrying the same logical mutation',
  );
  return command;
}

export function resolveIdempotency(options: IdempotencyOptions) {
  return {
    idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
  };
}
