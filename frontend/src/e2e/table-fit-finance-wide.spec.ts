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

const CATEGORY_NAMES = [
  'Apparatus Maintenance and Emergency Vehicle Repairs',
  'Personal Protective Equipment and Turnout Gear Replacement',
  'Training, Certification and Conference Registration',
  'Station Facilities, Utilities and Building Maintenance',
];

// The fifth is a sub-category of the first, so the list draws a subtotal row.
const budgetCategories = [...CATEGORY_NAMES, 'Aerial Ladder Annual Certification and Pump Testing'].map((name, i) => ({
  id: `cat-${i}`,
  organizationId: 'org-1',
  name,
  parentCategoryId: i === 4 ? 'cat-0' : undefined,
  sortOrder: i,
  isActive: true,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

const budgets = budgetCategories.map((category, i) => ({
  id: `budget-${i}`,
  organizationId: 'org-1',
  fiscalYearId: 'fy-1',
  categoryId: category.id,
  categoryName: category.name,
  amountBudgeted: '248750.00',
  amountSpent: '183420.55',
  amountEncumbered: '42315.20',
  stationId: `station-${i}`,
  stationName: `Station ${i + 11} - Northwest Headquarters Annex`,
  ownerPositionId: 'position-1',
  ownerPositionName: 'Deputy Chief of Operations and Logistics',
  effectiveOwnerPositionId: 'position-1',
  effectiveOwnerPositionName: 'Deputy Chief of Operations and Logistics',
  ownerInherited: false,
  amendmentCount: 2,
  createdBy: 'user-1',
  createdAt: CREATED,
  updatedAt: CREATED,
}));

const purchaseRequests = [0, 1, 2, 3].map((i) => ({
  id: `pr-${i}`,
  organizationId: 'org-1',
  requestNumber: `PR-2026-00${140 + i}`,
  fiscalYearId: 'fy-1',
  requestedBy: 'user-1',
  title: 'Replacement self-contained breathing apparatus cylinders and carbon fiber wrap kits for Engine 14',
  vendor: 'Municipal Emergency Services Equipment Distributors LLC',
  estimatedAmount: '184250.00',
  status: 'pending_approval',
  priority: 'urgent',
  createdAt: CREATED,
  updatedAt: CREATED,
  approvalSteps: [],
}));

async function openFinancePage(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await signIn(page, { permissions: PERMISSIONS });
  await page.route('**/api/v1/finance/fiscal-years**', (route) => void route.fulfill(json([fiscalYear])));
  await page.route('**/api/v1/finance/budget-categories**', (route) => void route.fulfill(json(budgetCategories)));
}

// The budget lines: category, station, owner, four six-digit amounts, a
// 160px progress bar and an open link, with category subtotals and a totals
// footer. The widest list in finance, so it is shown as a table only on a
// desktop.
test.describe('Budgets table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/budgets — ${viewport.name}`, async ({ page }) => {
      await openFinancePage(page, viewport);
      await page.route('**/api/v1/finance/budgets**', (route) => void route.fulfill(json(budgets)));
      await page.goto('/finance/budgets');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Encumbered', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Budgets table');
    });
  }
});

// The purchase requests list: request number, a long title, a long vendor kept
// on one line, a six-digit amount, priority and status badges, and the date.
test.describe('Purchase requests table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/purchase-requests — ${viewport.name}`, async ({ page }) => {
      await openFinancePage(page, viewport);
      await page.route('**/api/v1/finance/purchase-requests**', (route) => void route.fulfill(json(purchaseRequests)));
      await page.goto('/finance/purchase-requests');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Priority', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Purchase requests table');
    });
  }
});
