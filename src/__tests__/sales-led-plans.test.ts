import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSalesLedPlansCommand } from '../commands/sales-led-plans.js';

const list = vi.fn();
const get = vi.fn();
const create = vi.fn();
const update = vi.fn();
const reorder = vi.fn();
const publish = vi.fn();
const hide = vi.fn();
const archive = vi.fn();

vi.mock('../api/sales-led-plans.js', () => ({
  createSalesLedPlansClient: () => ({
    list,
    get,
    create,
    update,
    reorder,
    publish,
    hide,
    archive,
  }),
}));

vi.mock('../lib/auth.js', () => ({
  resolveAuth: () => ({
    apiKey: 'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    baseUrl: 'http://localhost:3000/api/v1',
  }),
}));

function buildProgram() {
  const program = new Command();
  program.exitOverride();
  registerSalesLedPlansCommand(program);
  return program;
}

const PLAN = { object: 'sales_led_plan', id: 'plan_1' };
const BODY = JSON.stringify({
  name: 'Full search',
  description: 'Managed',
  priceText: 'From $499',
  ctaText: 'Talk to us',
  ctaDestination: 'sales@example.com',
  featuredBullets: ['A'],
  isPublic: true,
  displayOrder: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [
    list,
    get,
    create,
    update,
    reorder,
    publish,
    hide,
    archive,
  ]) {
    fn.mockResolvedValue({
      data: PLAN,
      error: undefined,
      response: new Response(),
    });
  }
  list.mockResolvedValue({
    data: { object: 'list', data: [PLAN] },
    error: undefined,
    response: new Response(),
  });
});

describe('cavuno sales-led-plans', () => {
  it('list maps to list()', async () => {
    await buildProgram().parseAsync(['sales-led-plans', 'list'], {
      from: 'user',
    });
    expect(list).toHaveBeenCalled();
  });

  it('get maps to get(id)', async () => {
    await buildProgram().parseAsync(['sales-led-plans', 'get', 'plan_1'], {
      from: 'user',
    });
    expect(get).toHaveBeenCalledWith('plan_1');
  });

  it('create maps body + idempotency', async () => {
    await buildProgram().parseAsync(
      [
        'sales-led-plans',
        'create',
        '--body',
        BODY,
        '--idempotency-key',
        'idem-1',
      ],
      { from: 'user' },
    );
    expect(create).toHaveBeenCalledWith(JSON.parse(BODY), {
      idempotencyKey: 'idem-1',
    });
  });

  it('update / reorder / publish / hide / archive map correctly', async () => {
    const program = buildProgram();
    await program.parseAsync(
      [
        'sales-led-plans',
        'update',
        'plan_1',
        '--body',
        BODY,
        '--idempotency-key',
        'u',
      ],
      { from: 'user' },
    );
    await program.parseAsync(
      [
        'sales-led-plans',
        'reorder',
        '--body',
        '{"orders":[{"id":"plan_1","displayOrder":0}]}',
        '--idempotency-key',
        'r',
      ],
      { from: 'user' },
    );
    await program.parseAsync(
      ['sales-led-plans', 'publish', 'plan_1', '--idempotency-key', 'p'],
      { from: 'user' },
    );
    await program.parseAsync(
      ['sales-led-plans', 'hide', 'plan_1', '--idempotency-key', 'h'],
      { from: 'user' },
    );
    await program.parseAsync(
      ['sales-led-plans', 'archive', 'plan_1', '--idempotency-key', 'a'],
      { from: 'user' },
    );

    expect(update).toHaveBeenCalled();
    expect(reorder).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith('plan_1', { idempotencyKey: 'p' });
    expect(hide).toHaveBeenCalledWith('plan_1', { idempotencyKey: 'h' });
    expect(archive).toHaveBeenCalledWith('plan_1', { idempotencyKey: 'a' });
  });
});
