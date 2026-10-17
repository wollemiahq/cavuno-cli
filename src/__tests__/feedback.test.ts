import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerFeedbackCommand } from '../commands/feedback.js';
import { CliError } from '../lib/auth.js';
import { FEEDBACK_HINT, fromApiError } from '../lib/error.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function createProgram() {
  const program = new Command();
  program
    .name('cavuno')
    .version('9.9.9')
    .exitOverride()
    .option('--api-url <url>')
    .option('--format <format>', 'Output format', 'json');
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerFeedbackCommand(program);
  return program;
}

const run = (...argv: string[]) =>
  createProgram().parseAsync(['node', 'cavuno', 'feedback', ...argv], {
    from: 'node',
  });

const required = [
  '--type',
  'missing_capability',
  '--goal',
  'List jobs by salary',
  '--message',
  'GET /v1/jobs has no salary filter',
];

describe('feedback CLI command', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    delete process.env.CAVUNO_API_KEY;
    process.env.CAVUNO_API_URL = 'http://localhost:3000/api/v1';
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'fb_abc',
            status: 'accepted',
            received_at: '2026-10-17T00:00:00.000Z',
          }),
          { status: 202 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    delete process.env.CAVUNO_API_URL;
    vi.unstubAllGlobals();
    logSpy.mockRestore();
  });

  it('sends an anonymous report as `cavuno feedback` and prints the acknowledgement', async () => {
    await run(...required, '--outcome', 'blocked', '--agent-name', 'agent');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/api/v1/feedback');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['X-Agent-Feedback-Source']).toBe('cli');
    expect(JSON.parse(init.body)).toEqual({
      type: 'missing_capability',
      goal: 'List jobs by salary',
      message: 'GET /v1/jobs has no salary filter',
      outcome: 'blocked',
      agent: { name: 'agent' },
      metadata: { cli_version: '9.9.9' },
    });
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string).id).toBe('fb_abc');
  });

  it('attributes the report when CAVUNO_API_KEY is valid', async () => {
    process.env.CAVUNO_API_KEY = VALID_KEY;

    await run('send', ...required, '--workaround', 'Filtered client-side');

    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers.Authorization).toBe(`Bearer ${VALID_KEY}`);
    expect(JSON.parse(init.body)).toMatchObject({
      workaround: true,
      workaround_description: 'Filtered client-side',
    });
  });

  it('refuses to send without the required fields', async () => {
    await expect(run('--type', 'bug')).rejects.toThrow(
      /missing --goal, --message/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a rejected report and tells the agent to carry on', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'invalid_feedback',
            message: 'goal: must not be empty',
            details: [{ path: 'goal', message: 'must not be empty' }],
          },
        }),
        { status: 400 },
      ),
    );

    const error = await run(...required).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(2);
    expect((error as CliError).message).toContain('- goal: must not be empty');
    expect((error as CliError).message).toContain('Continue with your task.');
  });
});

describe('API error hint', () => {
  it('ends every API error with one line pointing at cavuno feedback', () => {
    const err = fromApiError(
      { error: { code: 'jobs_not_found', message: 'Job not found' } },
      { status: 404, headers: new Headers() },
    );
    expect(err.message.split('\n').at(-1)).toBe(FEEDBACK_HINT);
  });
});
