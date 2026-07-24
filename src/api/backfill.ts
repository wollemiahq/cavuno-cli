import {
  type CavunoClient,
  type CavunoClientOptions,
  type IdempotencyOptions,
  createCavunoClient,
} from './client.js';

import type { paths } from './generated/openapi-types.js';

/**
 * Ergonomic facade for the v1 Backfill product resource.
 *
 * The public resource exposes product-level rules, company state, and progress.
 * Provider-specific identifiers and implementation details never appear on the
 * wire.
 */
type JsonBody<P> = P extends {
  requestBody?: { content: { 'application/json': infer C } };
}
  ? C
  : never;

type Query<P> = P extends {
  parameters?: { query?: infer Q };
}
  ? Q
  : never;

export type CreateBackfillRuleBody = JsonBody<paths['/backfill/rules']['post']>;
export type UpdateBackfillRuleBody = JsonBody<
  paths['/backfill/rules/{id}']['patch']
>;
export type ListBackfillCompaniesQuery = Query<
  paths['/backfill/companies']['get']
>;
export type BulkBackfillCompaniesBody = JsonBody<
  paths['/backfill/companies/bulk-start']['post']
>;
export type MatchBackfillCompanyBody = JsonBody<
  paths['/backfill/companies/{companyId}/match']['post']
>;

export function createBackfillClient(opts: CavunoClientOptions) {
  const c: CavunoClient = createCavunoClient(opts);
  const idem = ({ idempotencyKey }: IdempotencyOptions) => ({
    'Idempotency-Key': idempotencyKey,
  });

  return {
    // ── Named rules ──────────────────────────────────────────────────────
    listRules: () => c.GET('/backfill/rules', {}),
    getRule: (id: string) =>
      c.GET('/backfill/rules/{id}', { params: { path: { id } } }),
    createRule: (
      body: CreateBackfillRuleBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/backfill/rules', {
        body,
        headers: idem(idempotency),
      }),
    updateRule: (
      id: string,
      body: UpdateBackfillRuleBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.PATCH('/backfill/rules/{id}', {
        params: { path: { id } },
        body,
        headers: idem(idempotency),
      }),
    removeRule: (id: string, idempotency: IdempotencyOptions) =>
      c.DELETE('/backfill/rules/{id}', {
        params: { path: { id } },
        headers: idem(idempotency),
      }),

    // ── Companies ────────────────────────────────────────────────────────
    listCompanies: (query: ListBackfillCompaniesQuery) =>
      c.GET('/backfill/companies', { params: { query } }),
    startCompany: (companyId: string, idempotency: IdempotencyOptions) =>
      c.POST('/backfill/companies/{companyId}/start', {
        params: { path: { companyId } },
        headers: idem(idempotency),
      }),
    stopCompany: (companyId: string, idempotency: IdempotencyOptions) =>
      c.POST('/backfill/companies/{companyId}/stop', {
        params: { path: { companyId } },
        headers: idem(idempotency),
      }),
    bulkStartCompanies: (
      body: BulkBackfillCompaniesBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/backfill/companies/bulk-start', {
        body,
        headers: idem(idempotency),
      }),
    bulkStopCompanies: (
      body: BulkBackfillCompaniesBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/backfill/companies/bulk-stop', {
        body,
        headers: idem(idempotency),
      }),
    matchCompany: (
      companyId: string,
      body: MatchBackfillCompanyBody,
      idempotency: IdempotencyOptions,
    ) =>
      c.POST('/backfill/companies/{companyId}/match', {
        params: { path: { companyId } },
        body,
        headers: idem(idempotency),
      }),
    markNoMatch: (companyId: string, idempotency: IdempotencyOptions) =>
      c.POST('/backfill/companies/{companyId}/mark-no-match', {
        params: { path: { companyId } },
        headers: idem(idempotency),
      }),

    // ── Progress ─────────────────────────────────────────────────────────
    getProgress: () => c.GET('/backfill/progress', {}),
  };
}

export type BackfillClient = ReturnType<typeof createBackfillClient>;
