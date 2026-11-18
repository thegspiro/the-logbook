import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'finance.view', 'finance.request', 'finance.manage', 'finance.approve'];
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

// A draft the signed-in member owns, so the table carries its Actions column
// and receipt controls; the third line is a mileage line with a trip log.
const expenseReport = {
  id: 'er-1',
  organizationId: 'org-1',
  reportNumber: 'ER-2026-00214',
  submittedBy: TEST_USER.id,
  fiscalYearId: 'fy-1',
  title: 'Fire Department Instructors Conference travel, lodging and registration — Indianapolis',
  totalAmount: '128475.90',
  status: 'draft',
  createdAt: CREATED,
  updatedAt: CREATED,
  approvalSteps: [],
  lineItems: [0, 1, 2].map((i) => ({
    id: `line-${i}`,
    expenseReportId: 'er-1',
    budgetId: 'budget-1',
    budgetLabel: 'Training, Certification and Conference Registration — Station 14 Northwest Headquarters Annex',
    fundName: 'Firefighter Assistance Grant Restricted Training Fund',
    description: 'Hotel lodging for four nights at the Indiana Convention Center Marriott, double occupancy',
    amount: '42825.30',
    dateIncurred: '2026-10-01',
    expenseType: i === 2 ? 'mileage' : 'travel',
    receiptDocumentId: i === 2 ? null : `doc-${i}`,
    receiptFileUrl: i === 2 ? null : `/api/v1/documents/doc-${i}/download`,
    merchant: 'Indianapolis Marriott Downtown Convention Center Hotel',
    mileageTrips:
      i === 2
        ? [
            {
              tripDate: '2026-10-01',
              fromLocation: 'Station 14 Northwest Headquarters Annex',
              toLocation: 'Indiana Convention Center, Indianapolis',
              purpose: 'Conference travel',
              miles: '184.6',
            },
          ]
        : null,
    mileageRate: i === 2 ? '0.70' : null,
    totalMiles: i === 2 ? '184.6' : null,
    createdAt: CREATED,
  })),
};

// The expense report's line items: a long description over its budget line,
// fund and trip log, the expense type with its functional class control, the
// receipt controls, the amount, and edit/remove actions, with a totals footer.
test.describe('Expense report line items table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/expenses/:id — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/finance/fiscal-years**', (route) => void route.fulfill(json([fiscalYear])));
      await page.route('**/api/v1/finance/expense-reports/er-1', (route) => void route.fulfill(json(expenseReport)));
      await page.goto('/finance/expenses/er-1');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Receipt', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Expense line items table');
    });
  }
});
