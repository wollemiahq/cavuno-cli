import { afterEach, describe, expect, it, vi } from 'vitest';

import { printJson, printTable } from '../lib/output.js';

afterEach(() => vi.restoreAllMocks());

describe('safe terminal tables', () => {
  it('renders untrusted names as text without terminal commands or extra lines', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printTable([
      {
        name: 'Alice\x1b]52;c;c2VjcmV0\x07',
        company: '\x1b[2JAcme\r\nforged\b\x9b2J',
      },
      { name: 'Zoë', company: '普通' },
    ]);
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(line).not.toMatch(/[\x00-\x1f\x7f-\x9f]/u);
    expect(lines[2]).toContain('Alice');
    expect(lines[2]).not.toContain('c2VjcmV0');
    expect(lines[3]).toContain('Zoë');
    expect(lines[3]).toContain('普通');
  });

  it('sanitizes table headings and preserves JSON data for machines', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const rows = [{ ['name\x1b[2J\n']: 'Alice\x1b[31m' }];
    printTable(rows);
    expect(log.mock.calls.flat().join('')).not.toMatch(/[\x00-\x1f\x7f-\x9f]/u);
    log.mockClear();
    printJson(rows);
    expect(JSON.parse(log.mock.calls[0]![0])).toEqual(rows);
  });
});
