import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuestion } = vi.hoisted(() => ({
  mockQuestion: vi.fn(),
}));

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: vi.fn(),
  })),
}));

import { confirmOrAbort, withYesOption } from '../lib/confirm.js';

describe('withYesOption', () => {
  it('adds a --yes flag with a -y alias', () => {
    const command = withYesOption(new Command('delete'));
    const option = command.options.find((o) => o.long === '--yes');
    expect(option).toBeDefined();
    expect(option!.short).toBe('-y');
    expect(command.opts<{ yes?: boolean }>()).toEqual({});
  });
});

describe('confirmOrAbort', () => {
  const originalStdin = process.stdin.isTTY;
  const originalStdout = process.stdout.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.stdin.isTTY = originalStdin;
    process.stdout.isTTY = originalStdout;
  });

  it('returns without prompting when --yes is set', async () => {
    await expect(
      confirmOrAbort({ message: 'Delete it?', yes: true }),
    ).resolves.toBeUndefined();
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it('refuses with exit code 2 when not attached to a TTY', async () => {
    (process.stdin as { isTTY?: boolean }).isTTY = undefined;
    (process.stdout as { isTTY?: boolean }).isTTY = undefined;
    await expect(
      confirmOrAbort({ message: 'Delete it?', yes: false }),
    ).rejects.toMatchObject({
      exitCode: 2,
      message:
        'This command is destructive. Pass --yes to run it non-interactively.',
    });
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it('proceeds when the interactive answer is y or yes (case-insensitive)', async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    for (const answer of ['y', 'Y', 'yes', 'YES']) {
      mockQuestion.mockResolvedValueOnce(answer);
      await expect(
        confirmOrAbort({ message: 'Delete it?', yes: false }),
      ).resolves.toBeUndefined();
    }
    expect(mockQuestion).toHaveBeenCalledWith('Delete it? (y/N) ');
  });

  it('aborts with exit code 2 on any other interactive answer', async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    mockQuestion.mockResolvedValueOnce('');
    await expect(
      confirmOrAbort({ message: 'Delete it?', yes: false }),
    ).rejects.toMatchObject({ exitCode: 2, message: 'Aborted.' });

    mockQuestion.mockResolvedValueOnce('n');
    await expect(
      confirmOrAbort({ message: 'Delete it?', yes: false }),
    ).rejects.toMatchObject({ exitCode: 2, message: 'Aborted.' });
  });
});
