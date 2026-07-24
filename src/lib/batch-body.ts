import { readJsonBodyFromFileOrStdin } from './json-body.js';

/**
 * Read a batch request body from `--file <path>` or piped stdin, shared by
 * `jobs`/`companies`/`blog posts` batch. Thin wrapper over the shared
 * JSON-body reader (exit 2 on every failure mode).
 */
export async function readBatchBody(
  file?: string,
): Promise<Record<string, unknown>> {
  return readJsonBodyFromFileOrStdin(file, {
    command: 'batch',
    shapeHint: '{ "operations": [...] }',
  });
}
