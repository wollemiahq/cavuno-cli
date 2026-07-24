import { readFile } from 'node:fs/promises';

/**
 * Read a JSON request body from `--file <path>` or piped stdin — the shared
 * reader behind `jobs`/`companies`/`blog posts` batch and
 * `settings job-form-set-custom-fields`. Every failure mode prints a clean
 * one-line `<command>:`-prefixed message and exits 2 (validation_bad_request)
 * — never a raw stack trace: an interactive terminal with no input, an
 * unreadable/missing file, an empty body, or invalid JSON.
 */
export async function readJsonBodyFromFileOrStdin(
  file: string | undefined,
  opts: { command: string; shapeHint: string },
): Promise<Record<string, unknown>> {
  const { command, shapeHint } = opts;
  if (file === undefined && process.stdin.isTTY) {
    console.error(
      `${command}: pass --file <path> or pipe JSON on stdin (shape: ${shapeHint})`,
    );
    process.exit(2);
  }

  let raw: string;
  if (file !== undefined) {
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`${command}: could not read --file ${file}: ${reason}`);
      process.exit(2);
    }
  } else {
    raw = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (c) => chunks.push(Buffer.from(c)));
      process.stdin.on('end', () =>
        resolve(Buffer.concat(chunks).toString('utf8')),
      );
      process.stdin.on('error', reject);
    });
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    console.error(
      `${command}: expected JSON body via --file or stdin (shape: ${shapeHint})`,
    );
    process.exit(2);
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    console.error(`${command}: body is not valid JSON`);
    process.exit(2);
  }
}
