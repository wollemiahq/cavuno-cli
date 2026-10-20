import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPlanAssignments: vi.fn(),
  assignPlan: vi.fn(),
  revokePlanAssignment: vi.fn(),
  listPlanInvoices: vi.fn(),
  invoicePlan: vi.fn(),
  cancelPlanInvoice: vi.fn(),
}));

vi.mock('../api/companies.js', () => ({
  createCompaniesClient: vi.fn(() => mocks),
}));

import { registerCompaniesCommand } from '../commands/companies.js';

const VALID_KEY =
  'cavuno_live_abcdefghijklmnop_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function createProgram() {
  const program = new Command();
  program
    .exitOverride()
    .option('--api-url <url>')
    .option('--format <format>', 'Output format', 'json');
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerCompaniesCommand(program);
  return program;
}

function ok(data: unknown) {
  return { data, error: undefined, response: new Response(null) };
}

async function run(...args: string[]) {
  await createProgram().parseAsync(['node', 'cavuno', 'companies', ...args], {
    from: 'node',
  });
}

describe('companies plan assignment and plan invoice commands', () => {
  let originalKey: string | undefined;
  let originalUrl: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.CAVUNO_API_KEY;
    originalUrl = process.env.CAVUNO_API_URL;
    process.env.CAVUNO_API_KEY = VALID_KEY;
    process.env.CAVUNO_API_URL = 'http://localhost:3000/api/v1';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.clearAllMocks();
    for (const fn of Object.values(mocks)) {
      fn.mockResolvedValue(ok({ object: 'company_plan_invoice', id: 'x' }));
    }
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CAVUNO_API_KEY;
    else process.env.CAVUNO_API_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.CAVUNO_API_URL;
    else process.env.CAVUNO_API_URL = originalUrl;
    logSpy.mockRestore();
  });

  it('lists plan assignments with filters', async () => {
    await run('list-plan-assignments', 'k18co', '--status', 'active');
    expect(mocks.listPlanAssignments).toHaveBeenCalledWith('k18co', {
      status: 'active',
    });
  });

  it('assigns a plan with a generated idempotency key', async () => {
    await run(
      'assign-plan',
      'k18co',
      '--plan',
      'k22gold',
      '--expires-at',
      '2027-01-01T00:00:00Z',
    );
    const [id, body, idempotency] = mocks.assignPlan.mock.calls[0]!;
    expect(id).toBe('k18co');
    expect(body).toEqual({
      planId: 'k22gold',
      expiresAt: '2027-01-01T00:00:00Z',
    });
    expect(idempotency.idempotencyKey).toEqual(expect.any(String));
  });

  it('revokes an assignment after confirmation', async () => {
    await run('revoke-plan', 'k18co', 'k33assign', '--yes');
    expect(mocks.revokePlanAssignment).toHaveBeenCalledWith(
      'k18co',
      'k33assign',
      { idempotencyKey: expect.any(String) },
    );
  });

  it('lists plan invoices', async () => {
    await run('list-plan-invoices', 'k18co', '--limit', '10');
    expect(mocks.listPlanInvoices).toHaveBeenCalledWith('k18co', {
      limit: 10,
    });
  });

  it('invoices a plan and reuses a caller idempotency key', async () => {
    await run(
      'invoice-plan',
      'k18co',
      '--plan',
      'k22silver',
      '--email',
      'billing@acme.test',
      '--amount-cents',
      '49900',
      '--currency',
      'usd',
      '--interval',
      'month',
      '--interval-count',
      '3',
      '--idempotency-key',
      'retry-1',
    );
    expect(mocks.invoicePlan).toHaveBeenCalledWith(
      'k18co',
      {
        planId: 'k22silver',
        contactEmail: 'billing@acme.test',
        amountCents: 49_900,
        currency: 'usd',
        billingInterval: 'month',
        billingIntervalCount: 3,
      },
      { idempotencyKey: 'retry-1' },
    );
  });

  it('cancels a plan invoice after confirmation', async () => {
    await run('cancel-plan-invoice', 'k18co', 'k44inv', '--yes');
    expect(mocks.cancelPlanInvoice).toHaveBeenCalledWith('k18co', 'k44inv', {
      idempotencyKey: expect.any(String),
    });
  });
});
