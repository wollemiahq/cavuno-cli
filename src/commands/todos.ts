import { Command } from 'commander';

import {
  createTodosClient,
  type CreateTodoBody,
  type UpdateTodoBody,
} from '../api/todos.js';
import { annotate } from '../lib/annotate.js';
import { resolveAuth } from '../lib/auth.js';
import {
  confirmOrAbort,
  type ConfirmOptions,
  withYesOption,
} from '../lib/confirm.js';
import { fromApiError } from '../lib/error.js';
import {
  type IdempotencyOptions,
  resolveIdempotency,
  withIdempotencyOption,
} from '../lib/idempotency.js';
import { print, type OutputFormat } from '../lib/output.js';

interface GlobalOpts {
  apiUrl?: string;
  format?: OutputFormat;
}

function getClient(parent: Command) {
  const opts = parent.optsWithGlobals<GlobalOpts>();
  const auth = resolveAuth({ apiUrl: opts.apiUrl });
  return createTodosClient({ apiKey: auth.apiKey, baseUrl: auth.baseUrl });
}

function getFormat(parent: Command): OutputFormat {
  return parent.optsWithGlobals<GlobalOpts>().format ?? 'json';
}

interface ApiResponse {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function unwrap(r: unknown): ApiResponse {
  return r as ApiResponse;
}

function parseIntArg(flag: string, min: number, max: number) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      console.error(`${flag}: expected integer ${min}-${max}, got ${raw}`);
      process.exit(2);
    }
    return n;
  };
}

/** `--assignee`: me, companion, none, or a member’s userId. */
function assigneeArg(value: string): UpdateTodoBody['assignee'] {
  if (value === 'me') return 'me';
  if (value === 'companion') return { kind: 'companion' };
  if (value === 'none') return null;
  return { kind: 'member', userId: value };
}

export function registerTodosCommand(root: Command): void {
  const todos = root
    .command('todos')
    .description(
      "Read and work through the to-dos on the Board's Home, the same list the dashboard shows.",
    );

  annotate(
    todos
      .command('list')
      .description(
        'List the Board’s to-dos in Home’s order: setup and starter to-dos, then the Board’s own (open in the operator’s order, then closed, newest first). Work from the top. Pass --cursor for more closed to-dos.',
      )
      .option(
        '--limit <n>',
        'Closed to-dos per page, 1-100 (default 25)',
        parseIntArg('--limit', 1, 100),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command) {
        const opts = this.opts<{ limit?: number; cursor?: string }>();
        const r = unwrap(await getClient(this).list(opts));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/todos',
      examples: ['cavuno todos list'],
    },
  );

  annotate(
    todos
      .command('get')
      .description('Fetch one to-do: an own one, or a setup or starter one.')
      .argument('<id>', 'To-do ID, for example search-console or an own ID')
      .action(async function (this: Command, id: string) {
        const r = unwrap(await getClient(this).get(id));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/todos/:id',
      examples: ['cavuno todos get search-console'],
    },
  );

  annotate(
    withIdempotencyOption(
      todos
        .command('add')
        .description('Add a to-do to the bottom of the Board’s own list.')
        .argument('<title>', 'The to-do as it reads on Home, in a few words')
        .option('--description <text>', 'Notes, links or reason, in Markdown')
        .option(
          '--done-when-metric <metric>',
          'Tick itself once this number reaches --at-least: liveJobs, publishedPosts, postsByReadyAuthor, companies, candidates, socialLinks or searchConsoleConnected',
        )
        .option('--at-least <n>', 'Target for --done-when-metric', Number),
    ).action(async function (this: Command, title: string) {
      const opts = this.opts<
        IdempotencyOptions & {
          description?: string;
          doneWhenMetric?: string;
          atLeast?: number;
        }
      >();
      const r = unwrap(
        await getClient(this).create(
          {
            title,
            ...(opts.description !== undefined
              ? { description: opts.description }
              : {}),
            ...(opts.doneWhenMetric !== undefined
              ? {
                  doneWhen: {
                    metric: opts.doneWhenMetric as NonNullable<
                      CreateTodoBody['doneWhen']
                    >['metric'],
                    atLeast: opts.atLeast ?? 1,
                  },
                }
              : {}),
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/todos',
      examples: [
        'cavuno todos add "Email 10 employers in your niche"',
        'cavuno todos add "Write a salary guide" --description "214 live jobs to draw from"',
        'cavuno todos add "Reach 250 live jobs" --done-when-metric liveJobs --at-least 250',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      todos
        .command('update')
        .description(
          'Change an own to-do’s title, description, status or assignee, as a person would. To hand it to the operator, comment what you need, then set `--status needs_review --assignee <their userId>`. Setup and starter to-dos cannot be changed.',
        )
        .argument('<id>', 'To-do ID')
        .option('--title <title>', 'New title')
        .option('--description <text>', 'New description; "" clears it')
        .option(
          '--status <status>',
          'open, in_progress, needs_review, done or canceled',
        )
        .option(
          '--assignee <who>',
          'me, companion, none, or a member’s userId (see `cavuno members list`)',
        )
        .option('--reopen', 'Reopen a closed to-do (same as --status open)'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & {
          title?: string;
          description?: string;
          status?: UpdateTodoBody['status'];
          assignee?: string;
          reopen?: boolean;
        }
      >();
      const body = {
        ...(opts.title !== undefined ? { title: opts.title } : {}),
        ...(opts.description !== undefined
          ? { description: opts.description || null }
          : {}),
        ...(opts.status !== undefined
          ? { status: opts.status }
          : opts.reopen
            ? { status: 'open' as const }
            : {}),
        ...(opts.assignee !== undefined
          ? { assignee: assigneeArg(opts.assignee) }
          : {}),
      };
      const r = unwrap(
        await getClient(this).update(id, body, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/todos/:id',
      examples: [
        'cavuno todos update k57abc --title "Email 20 employers"',
        'cavuno todos update k57abc --status in_progress',
        'cavuno todos update k57abc --assignee me',
        'cavuno todos update k57abc --status needs_review --assignee u_9f2k',
        'cavuno todos update k57abc --reopen',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      todos
        .command('complete')
        .description(
          'Mark an own to-do done (same as --status done). Say what was done in a comment. Setup and starter to-dos tick themselves.',
        )
        .argument('<id>', 'To-do ID'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).update(
          id,
          { status: 'done' },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/todos/:id',
      examples: ['cavuno todos complete k57abc'],
    },
  );

  annotate(
    withIdempotencyOption(
      todos
        .command('reorder')
        .description(
          'Move an own to-do next to another. Only when the operator asks: their order is the priority.',
        )
        .argument('<id>', 'To-do ID to move')
        .option('--before <id>', 'Sit directly above this own to-do')
        .option('--after <id>', 'Sit directly below this own to-do'),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<
        IdempotencyOptions & { before?: string; after?: string }
      >();
      if ((opts.before === undefined) === (opts.after === undefined)) {
        console.error('Pass exactly one of --before or --after.');
        process.exit(2);
      }
      const r = unwrap(
        await getClient(this).reorder(
          id,
          opts.before !== undefined
            ? { before: opts.before }
            : { after: opts.after! },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/todos/:id/reorder',
      examples: ['cavuno todos reorder k57abc --before k57def'],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        todos
          .command('remove')
          .description('Remove an own to-do without completing it.')
          .argument('<id>', 'To-do ID'),
      ),
    ).action(async function (this: Command, id: string) {
      const opts = this.opts<ConfirmOptions & IdempotencyOptions>();
      await confirmOrAbort({ message: `Remove to-do ${id}?`, yes: opts.yes });
      const r = unwrap(
        await getClient(this).remove(id, resolveIdempotency(opts)),
      );
      if (r.error) throw fromApiError(r.error, r.response);
    }),
    {
      mapsTo: 'DELETE /v1/todos/:id',
      examples: ['cavuno todos remove k57abc --yes'],
    },
  );

  annotate(
    todos
      .command('comments')
      .description(
        'List an own to-do’s activity, newest first: comments (a reply names its thread in `parentId`), and status and assignment changes. Pass --cursor for older ones.',
      )
      .argument('<id>', 'To-do ID')
      .option(
        '--limit <n>',
        'Page size 1-100 (default 25)',
        parseIntArg('--limit', 1, 100),
      )
      .option('--cursor <cursor>', 'Pagination cursor')
      .action(async function (this: Command, id: string) {
        const opts = this.opts<{ limit?: number; cursor?: string }>();
        const r = unwrap(await getClient(this).comments(id, opts));
        if (r.error) throw fromApiError(r.error, r.response);
        print(r.data, getFormat(this));
      }),
    {
      mapsTo: 'GET /v1/todos/:id/comments',
      examples: ['cavuno todos comments k57abc'],
    },
  );

  annotate(
    withIdempotencyOption(
      todos
        .command('comment')
        .description(
          'Comment on an own to-do or reply in a thread. A comment changes nothing else; to hand the to-do to someone, also run `cavuno todos update --status needs_review --assignee`.',
        )
        .argument('<id>', 'To-do ID')
        .argument('<body>', 'The comment, in plain text')
        .option('--reply-to <commentId>', 'Reply in this comment’s thread'),
    ).action(async function (this: Command, id: string, body: string) {
      const opts = this.opts<IdempotencyOptions & { replyTo?: string }>();
      const r = unwrap(
        await getClient(this).comment(
          id,
          {
            body,
            ...(opts.replyTo !== undefined ? { parentId: opts.replyTo } : {}),
          },
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'POST /v1/todos/:id/comments',
      examples: [
        'cavuno todos comment k57abc "Drafted the email; it is in the description."',
        'cavuno todos comment k57abc "Sent to Jane; she replies within a week." --reply-to k99xyz',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      todos
        .command('edit-comment')
        .description(
          'Change the words of a comment you wrote on an own to-do; Home marks it edited. Only its author can edit a comment.',
        )
        .argument('<id>', 'To-do ID')
        .argument('<commentId>', 'Comment ID from `cavuno todos comments`')
        .argument('<body>', 'The new words, in plain text'),
    ).action(async function (
      this: Command,
      id: string,
      commentId: string,
      body: string,
    ) {
      const opts = this.opts<IdempotencyOptions>();
      const r = unwrap(
        await getClient(this).editComment(
          id,
          commentId,
          body,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'PATCH /v1/todos/:id/comments/:commentId',
      examples: [
        'cavuno todos edit-comment k57abc k99xyz "Sent to Jane and Sam."',
      ],
    },
  );

  annotate(
    withIdempotencyOption(
      withYesOption(
        todos
          .command('delete-comment')
          .description(
            'Delete a comment you wrote on an own to-do (any comment, acting for the Board’s owner). Its words cannot be restored; replies keep their thread.',
          )
          .argument('<id>', 'To-do ID')
          .argument('<commentId>', 'Comment ID from `cavuno todos comments`'),
      ),
    ).action(async function (this: Command, id: string, commentId: string) {
      const opts = this.opts<ConfirmOptions & IdempotencyOptions>();
      await confirmOrAbort({
        message: `Delete comment ${commentId}?`,
        yes: opts.yes,
      });
      const r = unwrap(
        await getClient(this).deleteComment(
          id,
          commentId,
          resolveIdempotency(opts),
        ),
      );
      if (r.error) throw fromApiError(r.error, r.response);
      print(r.data, getFormat(this));
    }),
    {
      mapsTo: 'DELETE /v1/todos/:id/comments/:commentId',
      examples: ['cavuno todos delete-comment k57abc k99xyz --yes'],
    },
  );
}
