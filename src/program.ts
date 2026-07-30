import { Command } from 'commander';

import { registerAnalyticsCommand } from './commands/analytics.js';
import { registerBackfillCommand } from './commands/backfill.js';
import { registerBillingCommand } from './commands/billing.js';
import { registerBlogCommand } from './commands/blog.js';
import { registerCandidatesCommand } from './commands/candidates.js';
import { registerCompaniesCommand } from './commands/companies.js';
import { registerCouponsCommand } from './commands/coupons.js';
import { registerDomainsCommand } from './commands/domains.js';
import { registerEmployerSubscriptionsCommand } from './commands/employer-subscriptions.js';
import { registerEmployersCommand } from './commands/employers.js';
import { registerImportsCommand } from './commands/imports.js';
import { registerIndexingCommand } from './commands/indexing.js';
import { registerInvitationsCommand } from './commands/invitations.js';
import { registerJobsCommand, registerUsageCommand } from './commands/jobs.js';
import { registerMeCommand } from './commands/me.js';
import { registerMediaCommand } from './commands/media.js';
import { registerMembersCommand } from './commands/members.js';
import { registerOperationsCommand } from './commands/operations.js';
import { registerPaywallCommand } from './commands/paywall.js';
import { registerPlansCommand } from './commands/plans.js';
import { registerSalesLedPlansCommand } from './commands/sales-led-plans.js';
import { registerRedirectsCommand } from './commands/redirects.js';
import { registerReportingCommand } from './commands/reporting.js';
import { registerSettingsCommand } from './commands/settings.js';
import { registerSubscribersCommand } from './commands/subscribers.js';
import { registerTaxonomiesCommand } from './commands/taxonomies.js';
import { registerTransactionsCommand } from './commands/transactions.js';

export const PUBLIC_GROUPS = [
  'jobs',
  'usage',
  'me',
  'companies',
  'blog',
  'settings',
  'media',
  'domains',
  'operations',
  'taxonomies',
  'candidates',
  'employers',
  'employer-subscriptions',
  'coupons',
  'reporting',
  'billing',
  'plans',
  'transactions',
  'indexing',
  'imports',
  'backfill',
  'analytics',
  'paywall',
  'sales-led-plans',
  'members',
  'invitations',
  'subscribers',
  'redirects',
];

export function createCliProgram(version: string) {
  const program = new Command();
  program
    .name('cavuno')
    .description('Manage your Cavuno job board from the command line.')
    .version(version)
    .option(
      '--api-url <url>',
      'Override the API base URL (default: $CAVUNO_API_URL or https://api.cavuno.com/v1)',
    )
    .option(
      '--format <format>',
      'Output format: json (default, pipe-friendly) or table (human-friendly)',
      'json',
    );

  registerJobsCommand(program);
  registerUsageCommand(program);
  registerMeCommand(program);
  registerSettingsCommand(program);
  registerCompaniesCommand(program);
  registerDomainsCommand(program);
  registerBlogCommand(program);
  registerCandidatesCommand(program);
  registerEmployersCommand(program);
  registerReportingCommand(program);
  registerBillingCommand(program);
  registerPlansCommand(program);
  registerEmployerSubscriptionsCommand(program);
  registerTransactionsCommand(program);
  registerCouponsCommand(program);
  registerIndexingCommand(program);
  registerMediaCommand(program);
  registerImportsCommand(program);
  registerBackfillCommand(program);
  registerAnalyticsCommand(program);
  registerPaywallCommand(program);
  registerSalesLedPlansCommand(program);
  registerOperationsCommand(program);
  registerTaxonomiesCommand(program);
  registerMembersCommand(program);
  registerInvitationsCommand(program);
  registerSubscribersCommand(program);
  registerRedirectsCommand(program);

  return program;
}
