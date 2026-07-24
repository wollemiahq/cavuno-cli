/**
 * Format a v1 REST error envelope into a human-readable string.
 *
 * Shared error formatting for command-line and automation clients. Formerly
 * inline in the CLI's
 * `fromApiError`; extracted in Review 2 #4 so the AI-facing MCP tools
 * surface the same code/message/requestId/retry-after/zod-issue detail
 * as the CLI does, instead of dumping raw envelope JSON.
 *
 * Wire shape per `docs/api/v1/01-conventions.md §5.2`:
 *   { error: { code, message, requestId, details? } }
 *
 * The function is pure and synchronous: caller passes the parsed
 * `error` envelope (typed loosely as `unknown`) plus the `Response`
 * (for status + Retry-After header). Returns a multi-line string ready
 * to print or wrap in a transport-specific error.
 */

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
}

interface ResponseLike {
  status: number;
  headers: Headers;
}

/**
 * Pure formatter. Returns a string; never throws. Caller decides what
 * to do with the result (throw a typed error, write to stderr, wrap in
 * an MCP `content` array, etc.).
 *
 * Output shape:
 *   ✗ <code> (<status>)
 *     <message>
 *     - <issue.path>: <issue.message>          (when validation_*)
 *     retry-after: <Retry-After>s              (when 429)
 *     request-id: <requestId>                  (when present)
 */
export function formatApiError(
  envelope: unknown,
  response: ResponseLike,
): string {
  const env = envelope as ErrorEnvelope | undefined;
  const code = env?.error?.code ?? `http_${response.status}`;

  const lines: string[] = [];
  lines.push(`✗ ${code} (${response.status})`);
  if (env?.error?.message) lines.push(`  ${env.error.message}`);

  // Validation issues — pretty-print zod path/message tuples.
  const details = env?.error?.details as
    | { issues?: Array<{ path?: unknown[]; message?: string }> }
    | undefined;
  if (details?.issues) {
    for (const issue of details.issues) {
      const pathStr = Array.isArray(issue.path) ? issue.path.join('.') : '';
      lines.push(`  - ${pathStr ? `${pathStr}: ` : ''}${issue.message ?? ''}`);
    }
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) lines.push(`  retry-after: ${retryAfter}s`);
  }

  if (env?.error?.requestId) {
    lines.push(`  request-id: ${env.error.requestId}`);
  }

  return lines.join('\n');
}
