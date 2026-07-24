import { readMeta } from './annotate.js';

import type { Argument, Command, Option } from 'commander';

export interface CliManifest {
  version: string;
  generatedAt: string;
  groups: CliGroup[];
}

export interface CliGroup {
  name: string;
  description: string;
  commands: CliCommand[];
}

export interface CliCommand {
  name: string;
  description: string;
  synopsis: string;
  arguments: CliArgument[];
  options: CliOption[];
  examples: string[];
  mapsTo?: string;
}

export interface CliArgument {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
}

export interface CliOption {
  flags: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

interface BuildOptions {
  groups: string[];
  generatedAt?: string;
}

interface ArgumentInternals {
  _name?: string;
  description: string;
  required: boolean;
  variadic: boolean;
}

interface OptionInternals {
  flags: string;
  description: string;
  mandatory?: boolean;
  defaultValue?: unknown;
}

interface CommandInternals {
  registeredArguments?: Argument[];
  _args?: Argument[];
}

function getArguments(cmd: Command): Argument[] {
  const internals = cmd as unknown as CommandInternals;
  return internals.registeredArguments ?? internals._args ?? [];
}

function serializeArgument(arg: Argument): CliArgument {
  const internal = arg as unknown as ArgumentInternals;
  return {
    name: internal._name ?? '',
    description: internal.description ?? '',
    required: internal.required,
    variadic: internal.variadic,
  };
}

function serializeOption(opt: Option): CliOption {
  const internal = opt as unknown as OptionInternals;
  return {
    flags: internal.flags,
    description: internal.description ?? '',
    required: internal.mandatory === true,
    ...(internal.defaultValue !== undefined && {
      defaultValue: String(internal.defaultValue),
    }),
  };
}

function buildSynopsis(parentName: string, cmd: Command): string {
  const parts = [parentName, cmd.name()];
  for (const arg of getArguments(cmd)) {
    const internal = arg as unknown as ArgumentInternals;
    const name = internal._name ?? '';
    const wrapped = internal.required ? `<${name}>` : `[${name}]`;
    parts.push(internal.variadic ? `${wrapped}...` : wrapped);
  }
  if (cmd.options.length > 0) parts.push('[options]');
  return parts.join(' ');
}

function serializeCommand(parentName: string, cmd: Command): CliCommand {
  const meta = readMeta(cmd);
  return {
    name: cmd.name(),
    description: cmd.description(),
    synopsis: buildSynopsis(parentName, cmd),
    arguments: getArguments(cmd).map(serializeArgument),
    options: cmd.options.map(serializeOption),
    examples: meta?.examples ?? [],
    ...(meta?.mapsTo && { mapsTo: meta.mapsTo }),
  };
}

/**
 * Flatten a group's command tree into leaf commands. A nested subgroup
 * (e.g. `blog posts create`) collapses into a single command whose `name`
 * carries the path below the group ("posts create") and whose synopsis uses
 * the full invocation path. Flat groups (`jobs create`) are unchanged.
 */
function flattenCommands(
  synopsisParent: string,
  relativeName: string,
  cmd: Command,
): CliCommand[] {
  if (cmd.commands.length === 0) {
    const leaf = serializeCommand(synopsisParent, cmd);
    return [
      {
        ...leaf,
        name: relativeName ? `${relativeName} ${cmd.name()}` : cmd.name(),
      },
    ];
  }

  const childSynopsisParent = `${synopsisParent} ${cmd.name()}`;
  const childRelative = relativeName
    ? `${relativeName} ${cmd.name()}`
    : cmd.name();
  return cmd.commands.flatMap((sub) =>
    flattenCommands(childSynopsisParent, childRelative, sub),
  );
}

export function buildManifest(
  program: Command,
  options: BuildOptions,
): CliManifest {
  const allowList = new Set(options.groups);
  const order = new Map(options.groups.map((g, i) => [g, i]));

  const groups: CliGroup[] = program.commands
    .filter((cmd) => allowList.has(cmd.name()))
    .map((cmd) => {
      const groupName = `${program.name()} ${cmd.name()}`;
      return {
        name: cmd.name(),
        description: cmd.description(),
        commands: cmd.commands.flatMap((sub) =>
          flattenCommands(groupName, '', sub),
        ),
      };
    })
    .sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));

  return {
    version: program.version() ?? '0.0.0',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    groups,
  };
}
