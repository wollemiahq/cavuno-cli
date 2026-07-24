/**
 * Output formatters for CLI subcommands.
 *
 * Default `json` is pipe-friendly (jq-able). `table` is human-friendly
 * with a small column-aware printer that doesn't require a heavy lib.
 */

export type OutputFormat = 'json' | 'table';

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Trivial column-aligned table printer for arrays of flat objects.
 * Skips array/object cell values (replaces with `[…]` or `{…}`) so
 * deep shapes don't break alignment. Use `--format=json` for full data.
 */
export function printTable(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  const cols = Object.keys(rows[0]!);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => formatCell(r[c]).length)),
  );

  const header = cols.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(header);
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of rows) {
    const line = cols
      .map((c, i) => formatCell(row[c]).padEnd(widths[i]!))
      .join('  ');
    console.log(line);
  }
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}

export function print(
  data: unknown,
  format: OutputFormat,
  toRows?: (data: unknown) => Array<Record<string, unknown>>,
): void {
  if (format === 'table' && toRows) {
    printTable(toRows(data));
  } else {
    printJson(data);
  }
}
