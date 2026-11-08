import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'finance.view', 'finance.manage', 'finance.approve'];
const CREATED = '2026-10-14T15:30:00Z';

const fiscalYear = {
  id: 'fy-1',
  organizationId: 'org-1',
  name: 'Fiscal Year 2026-2027 Operating',
  startDate: '2026-07-01',
  endDate: '2027-06-30',
  status: 'active',
  isLocked: false,
  createdBy: 'user-1',
  createdAt: CREATED,
  updatedAt: CREATED,
};

const expenseReports = [0, 1, 2, 3].map((i) => ({
  id: `er-${i}`,
  organizationId: 'org-1',
  reportNumber: `ER-2026-00${210 + i}`,
  submittedBy: 'user-1',
  fiscalYearId: 'fy-1',
  title: 'Fire Department Instructors Conference travel, lodging and registration — Indianapolis',
  totalAmount: '128475.90',
  status: 'pending_approval',
  createdAt: CREATED,
  updatedAt: CREATED,
  lineItems: [
    {
      id: `er-${i}-line`,
      expenseReportId: `er-${i}`,
      description: 'Conference registration',
      amount: '895.00',
      dateIncurred: '2026-10-01',
      expenseType: 'general',
      createdAt: CREATED,
    },
  ],
  approvalSteps: [],
}));

const checkRequests = [0, 1, 2, 3].map((i) => ({
  id: `cr-${i}`,
  organizationId: 'org-1',
  requestNumber: `CR-2026-00${310 + i}`,
  requestedBy: 'user-1',
  fiscalYearId: 'fy-1',
  payeeName: 'Alexandra Ayala-Montgomery Consulting and Emergency Management Services',
  amount: '174320.45',
  checkNumber: `100${4820 + i}`,
  status: 'approved',
  createdAt: CREATED,
  updatedAt: CREATED,
  rows: [],
  total: '0',
}));

const fundBalances = {
  funds: [0, 1, 2, 3].map((i) => ({
    campaignId: `fund-${i}`,
    name: 'Capital Campaign for the New Ladder Truck and Aerial Platform Fund',
    purpose: 'Donor-restricted to the purchase and outfitting of a 107-foot aerial ladder apparatus',
    active: i !== 3,
    received: '845210.00',
    spent: '312450.75',
    committed: '128900.00',
    awaitingApproval: '45120.30',
    available: '403859.25',
  })),
  received: '3380840.00',
  spent: '1249803.00',
  committed: '515600.00',
  awaitingApproval: '180481.20',
  available: '1615437.00',
};

async function openFinancePage(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await signIn(page, { permissions: PERMISSIONS });
  await page.route('**/api/v1/finance/fiscal-years**', (route) => void route.fulfill(json([fiscalYear])));
}

// The expense reports list: report number, a long trip title, a six-digit
// total, item count, status and date. Overflows a phone and a narrow tablet.
test.describe('Expense reports table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/expenses — ${viewport.name}`, async ({ page }) => {
      await openFinancePage(page, viewport);
      await page.route('**/api/v1/finance/expense-reports**', (route) => void route.fulfill(json(expenseReports)));
      await page.goto('/finance/expenses');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Items', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Expense reports table');
    });
  }
});

// The check requests list: request number, a long payee, a six-digit amount,
// check number, status and date.
test.describe('Check requests table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/check-requests — ${viewport.name}`, async ({ page }) => {
      await openFinancePage(page, viewport);
      await page.route('**/api/v1/finance/check-requests**', (route) => void route.fulfill(json(checkRequests)));
      await page.goto('/finance/check-requests');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Check #', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Check requests table');
    });
  }
});

// The restricted funds report: fund with its purpose, five six- and seven-digit
// amounts, and a totals footer. Overflows a tablet with the navigation open.
test.describe('Restricted funds table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/reports?report=fund-balances — ${viewport.name}`, async ({ page }) => {
      await openFinancePage(page, viewport);
      await page.route('**/api/v1/finance/reports/fund-balances**', (route) => void route.fulfill(json(fundBalances)));
      await page.goto('/finance/reports?report=fund-balances');

      const table = page.getByRole('table').filter({
        has: page.getByRole('columnheader', { includeHidden: true, name: 'Awaiting approval', exact: true }),
      });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Restricted funds table');
    });
  }
});
