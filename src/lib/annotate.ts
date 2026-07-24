import type { Command } from 'commander';

export interface CommandMeta {
  examples?: string[];
  mapsTo?: string;
}

const META_KEY = Symbol.for('cavuno.cli.meta');

interface Annotated {
  [META_KEY]?: CommandMeta;
}

export function annotate(cmd: Command, meta: CommandMeta): Command {
  (cmd as unknown as Annotated)[META_KEY] = meta;
  return cmd;
}

export function readMeta(cmd: Command): CommandMeta | undefined {
  return (cmd as unknown as Annotated)[META_KEY];
}
