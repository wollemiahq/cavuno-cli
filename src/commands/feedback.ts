import { Command, Option } from 'commander';

import { annotate } from '../lib/annotate.js';
import { CliError } from '../lib/auth.js';
import { readJsonBodyFromFileOrStdin } from '../lib/json-body.js';
import { print, type OutputFormat } from '../lib/output.js';

/**
 * `cavuno feedback`: report a problem an agent hit with Cavuno, in the
 * Agent Feedback Protocol v0.1 shape (https://trybackloop.com/spec/).
 * Works without credentials; a valid `CAVUNO_API_KEY` attributes the report
 * to its board. Best effort: a failed report exits non-zero but never
 * changes anything else.
 */

const DEFAULT_API_URL = 'https://api.cavuno.com/v1';
const KEY_PATTERN = /^cavuno_live_[a-z2-7]{16}_[A-Za-z0-9_-]{32}$/;
const TIMEOUT_MS = 10_000;

export const FEEDBACK_TYPES = [
  'missing_capability',
  'bug',
  'unclear_documentation',
  'unexpected_response',
  'unhelpful_error',
  'performance',
  'other',
] as const;

const OUTCOMES = ['blocked', 'degraded', 'completed'] as const;
const METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

interface FeedbackOpts {
  type?: string;
  goal?: string;
  message?: string;
  endpoint?: string;
  method?: string;
  outcome?: string;
  expected?: string;
  suggestion?: string;
  workaround?: string | boolean;
  sessionId?: string;
  requestId?: string;
  agentName?: string;
  agentModel?: string;
  json?: boolean;
  file?: string;
}

function rootOf(cmd: Command): Command {
  let node = cmd;
  while (node.parent) node = node.parent;
  return node;
}

function definedEntries(
  entries: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  );
}

export function buildFeedbackBody(
  opts: FeedbackOpts,
  base: Record<string, unknown>,
  cliVersion: string,
): Record<string, unknown> {
  const workaround =
    typeof opts.workaround === 'string'
      ? opts.workaround
      : opts.workaround === true
        ? ''
        : undefined;
  const body: Record<string, unknown> = {
    ...base,
    ...definedEntries({
      type: opts.type,
      goal: opts.goal,
      message: opts.message,
      endpoint: opts.endpoint,
      method: opts.method,
      outcome: opts.outcome,
      expected: opts.expected,
      suggestion: opts.suggestion,
      session_id: opts.sessionId,
      request_id: opts.requestId,
    }),
  };
  if (workaround !== undefined) {
    body.workaround = true;
    if (workaround) body.workaround_description = workaround;
  }
  const baseAgent =
    base.agent && typeof base.agent === 'object' && !Array.isArray(base.agent)
      ? (base.agent as Record<string, unknown>)
      : {};
  const agent = {
    ...baseAgent,
    ...definedEntries({ name: opts.agentName, model: opts.agentModel }),
  };
  if (Object.keys(agent).length > 0) body.agent = agent;
  const baseMetadata =
    base.metadata &&
    typeof base.metadata === 'object' &&
    !Array.isArray(base.metadata)
      ? (base.metadata as Record<string, unknown>)
      : {};
  body.metadata = { ...baseMetadata, cli_version: cliVersion };
  return body;
}

function feedbackError(
  status: number,
  payload: unknown,
  retryAfter: string | null,
): CliError {
  const error = (payload as { error?: Record<string, unknown> } | undefined)
    ?.error;
  const code = typeof error?.code === 'string' ? error.code : `http_${status}`;
  const lines = [`✗ ${code} (${status})`];
  if (typeof error?.message === 'string') lines.push(`  ${error.message}`);
  if (Array.isArray(error?.details)) {
    for (const detail of error.details as Array<Record<string, unknown>>) {
      lines.push(`  - ${String(detail.path ?? '')}: ${String(detail.message)}`);
    }
  }
  if (retryAfter) lines.push(`  retry-after: ${retryAfter}s`);
  lines.push('  Feedback was not recorded. Continue with your task.');
  const exit =
    status === 429
      ? 6
      : status === 400 || status === 413 || status === 415
        ? 2
        : 10;
  return new CliError(lines.join('\n'), exit);
}

export function registerFeedbackCommand(root: Command): void {
  const feedback = root
    .command('feedback')
    .description(
      'Report a problem with Cavuno (API, CLI, MCP or SDK) to its engineers, as an AI agent or a person.',
    );

  annotate(
    feedback
      .command('send', { isDefault: true })
      .description(
        'Send an Agent Feedback Protocol report. Works without CAVUNO_API_KEY; a valid key attributes it to your board. ' +
          'Never include credentials or personal data. 20 reports per 5 minutes.',
      )
      .addOption(
        new Option(
          '--type <type>',
          'Kind of problem (required unless --json)',
        ).choices(FEEDBACK_TYPES),
      )
      .option(
        '--goal <text>',
        'What you were trying to accomplish, in plain language (required unless --json)',
      )
      .option(
        '--message <text>',
        'What prevented or complicated the task (required unless --json)',
      )
      .option(
        '--endpoint <path>',
        'API path, CLI command or MCP tool involved, e.g. /jobs',
      )
      .addOption(
        new Option('--method <method>', 'HTTP method of the endpoint').choices(
          METHODS,
        ),
      )
      .addOption(
        new Option(
          '--outcome <outcome>',
          'blocked (task failed), degraded (worse or slower), completed (suggestion only)',
        ).choices(OUTCOMES),
      )
      .option('--expected <text>', 'What you expected to find or happen')
      .option(
        '--suggestion <text>',
        'A concrete change that would have let you succeed',
      )
      .option(
        '--workaround [description]',
        'You found a workaround; optionally describe it',
      )
      .option(
        '--session-id <id>',
        'Reuse one value per task; a retry with the same content returns the original report',
      )
      .option('--request-id <id>', 'X-Request-Id of the failing call')
      .option('--agent-name <name>', 'Agent or product name')
      .option('--agent-model <model>', 'Model name')
      .option(
        '--json',
        'Read the full report as JSON from --file or stdin; flags override its fields',
      )
      .option('--file <path>', 'JSON report file for --json (otherwise stdin)')
      .action(async function (this: Command) {
        const opts = this.opts<FeedbackOpts>();
        const globals = this.optsWithGlobals<GlobalOpts>();
        const base = opts.json
          ? await readJsonBodyFromFileOrStdin(opts.file, {
              command: 'feedback',
              shapeHint: '{ "type": "...", "goal": "...", "message": "..." }',
            })
          : {};
        const body = buildFeedbackBody(
          opts,
          base,
          rootOf(this).version() ?? '',
        );
        const missing = ['type', 'goal', 'message'].filter(
          (key) => typeof body[key] !== 'string' || body[key] === '',
        );
        if (missing.length > 0) {
          throw new CliError(
            `feedback: missing ${missing.map((key) => `--${key}`).join(', ')} (or pass them in --json)`,
            2,
          );
        }

        const headers: Record<string, string> = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Agent-Feedback-Source': 'cli',
        };
        const apiKey = process.env.CAVUNO_API_KEY;
        if (apiKey && KEY_PATTERN.test(apiKey)) {
          headers.Authorization = `Bearer ${apiKey}`;
        }
        const baseUrl = (
          globals.apiUrl ??
          process.env.CAVUNO_API_URL ??
          DEFAULT_API_URL
        ).replace(/\/+$/, '');

        const response = await fetch(`${baseUrl}/feedback`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await response.text();
        let payload: unknown;
        try {
          payload = text ? JSON.parse(text) : undefined;
        } catch {
          payload = undefined;
        }
        if (!response.ok) {
          throw feedbackError(
            response.status,
            payload,
            response.headers.get('retry-after'),
          );
        }
        print(payload, globals.format ?? 'json');
      }),
    {
      mapsTo: 'POST /v1/feedback',
      examples: [
        'cavuno feedback --type missing_capability --goal "What you were trying to do" --message "What got in the way" --agent-name my-agent --agent-model model-name',
        'cavuno feedback --json --file report.json',
      ],
    },
  );
}
