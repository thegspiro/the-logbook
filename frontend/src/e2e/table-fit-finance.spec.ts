/**
 * Finance tables against the card they sit in, at tablet, laptop and desktop
 * widths (see `tableFit.ts`).
 *
 * Every table here is a `rwd-table` that keeps its column layout from 768px
 * up, so on a tablet with the side navigation open, or a laptop, its columns
 * can add up to more than the card is wide. The fixtures are deliberately long:
 * real budget-line names, member names and six-figure amounts, which is what
 * a department's data looks like and what a tidy fixture never tests.
 */

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

// =============================================================================
// Fixtures
// =============================================================================

const PERMISSIONS = [
  ...TEST_USER.permissions,
  'finance.view',
  'finance.manage',
  'finance.approve',
  'finance.configure_approvals',
  'finance.request',
];

const NAMES = ['Alexandra Ayala-Montgomery', 'Christopher Vanderbilt-Okonkwo', 'Maximilian Featherstonehaugh'];
const LINES = [
  'Personal Protective Equipment & Turnout Gear · Station 3 Northfield Headquarters',
  'Apparatus Maintenance and Fleet Repair · Station 12 Oakville Township Substation',
  'Training, Certification and Continuing Education · Department-wide',
];
const AMOUNTS = ['248750.00', '187325.50', '903412.75'];
const STATION = 'Station 12 Oakville Township Substation';
const INDEXES = [0, 1, 2] as const;

const name = (i: number) => NAMES[i % NAMES.length] ?? '';
const line = (i: number) => LINES[i % LINES.length] ?? '';
const amount = (i: number) => AMOUNTS[i % AMOUNTS.length] ?? '0.00';

const FISCAL_YEAR = {
  id: 'fy-2027',
  organizationId: 'e2e-org',
  name: 'Fiscal Year 2027 (January through December)',
  startDate: '2027-01-01',
  endDate: '2027-12-31',
  status: 'active',
  isLocked: false,
  requestsOpen: true,
  planningStage: 'requests',
  requestDeadline: '2026-12-15',
};

const BUDGET_REQUESTS = INDEXES.map((i) => ({
  id: `br-${i}`,
  organizationId: 'e2e-org',
  fiscalYearId: FISCAL_YEAR.id,
  lineLabel: line(i),
  isProposedLine: i === 2,
  ownerPositionName: 'Deputy Chief of Logistics and Support Services',
  requestedAmount: amount(i),
  approvedAmount: i === 0 ? null : amount(i + 1),
  status: ['submitted', 'approved', 'adjusted'][i],
  justification: 'Replacement cycle for gear past its ten-year service life.',
  submittedByName: name(i),
  submittedAt: '2026-10-14T15:00:00Z',
  reviewAmount: i === 2 ? '875000.00' : null,
  reviewedByName: i === 2 ? name(0) : null,
  lastYearBudgeted: amount(i + 2),
  lastYearSpent: amount(i + 1),
  createdAt: '2026-10-01T15:00:00Z',
  updatedAt: '2026-10-01T15:00:00Z',
}));

const ENTITY_TYPES = ['purchase_request', 'expense_report', 'check_request'];

const PENDING_APPROVALS = INDEXES.map((i) => ({
  stepRecordId: `step-${i}`,
  entityType: ENTITY_TYPES[i],
  entityId: `entity-${i}`,
  entityTitle: `PR-2026-00${i}4 Replacement SCBA cylinders and turnout gear for ${line(i)}`,
  entityAmount: amount(i),
  requesterName: name(i),
  stepName: 'Treasurer and Board of Fire Commissioners review',
  stepOrder: 1,
  submittedAt: '2026-10-14T15:00:00Z',
  assigneeLabel: 'Board of Fire Commissioners Finance Committee',
  canAct: i !== 1,
  requiresOverride: i === 1,
  lateLineCount: i === 1 ? 3 : 0,
  fundShortfall: i === 2 ? '12500.00' : null,
  emailDelivery: ['sent', 'failed', 'not_sent'][i],
  emailStatusAt: '2026-10-14T15:00:00Z',
  emailLinkVersion: 1,
  canResendEmail: true,
}));

const UNROUTED_APPROVALS = INDEXES.map((i) => ({
  entityType: ENTITY_TYPES[i],
  entityId: `unrouted-${i}`,
  entityTitle: `CR-2026-00${i}7 Annual hydrant flow testing contract for ${line(i)}`,
  entityAmount: amount(i),
  requesterName: name(i),
  submittedAt: '2026-10-14T15:00:00Z',
  awaitingSecondApproval: i === 1,
  lateLineCount: i === 2 ? 2 : 0,
  awaitingLateAcknowledgement: i === 2,
  fundShortfall: i === 0 ? '12500.00' : null,
}));

const BUDGET_VS_ACTUAL = {
  fiscalYearId: FISCAL_YEAR.id,
  fiscalYearName: FISCAL_YEAR.name,
  asOf: '2026-11-05',
  includesCommitted: true,
  rows: INDEXES.map((i) => ({
    budgetId: `budget-${i}`,
    categoryName: line(i),
    stationName: STATION,
    originalBudget: amount(i),
    amendments: '-125000.00',
    budget: amount(i + 1),
    spent: amount(i + 2),
    committed: '98765.43',
    remaining: '-612345.67',
    percentUsed: 104.7,
    runningSpent: '412345.67',
    runningSpentDiffers: i === 1,
  })),
  totals: {
    originalBudget: '1339488.25',
    amendments: '-375000.00',
    budget: '1339488.25',
    spent: '1339488.25',
    committed: '296296.29',
    remaining: '-1837036.01',
  },
};

const AMENDMENT_LOG = {
  fiscalYearId: FISCAL_YEAR.id,
  fiscalYearName: FISCAL_YEAR.name,
  confirmedNet: '-375000.00',
  rows: INDEXES.map((i) => ({
    amendmentId: `amendment-${i}`,
    budgetId: `budget-${i}`,
    categoryName: line(i),
    stationName: STATION,
    amount: `-${amount(i)}`,
    isReversal: i === 1,
    reason:
      'Transfer to cover emergency replacement of the Engine 7 pump transmission after the October mutual-aid fire',
    approvedBy: 'Board of Fire Commissioners, regular meeting resolution 2026-114',
    approvedOn: '2026-10-14',
    enteredByName: name(i),
    enteredAt: '2026-10-14T15:00:00Z',
    status: ['pending', 'confirmed', 'rejected'][i],
    decidedByName: name(i + 1),
    decidedAt: '2026-10-20T15:00:00Z',
    decisionNote: 'Confirmed against the signed board minutes and the treasurer’s reconciliation',
  })),
};

const PAYMENTS_REGISTER = {
  start: '2026-11-01',
  end: '2026-11-05',
  total: '1339488.25',
  rows: INDEXES.map((i) => ({
    paidOn: '2026-11-03',
    kind: ['purchase_request', 'check_void', 'advance_return'][i],
    entityId: `payment-${i}`,
    number: `PR-2026-001${i}4`,
    payee: ['MSA Safety Incorporated Fire Service Division', name(1), 'Northfield Hydraulics & Pump Repair LLC'][i],
    description:
      'Replacement SCBA cylinders, regulators and facepieces for the second-due engine company at Station 12',
    budgetLine: line(i),
    checkNumber: '0004812',
    amount: i === 1 ? `-${amount(i)}` : amount(i),
  })),
};

const ADVANCES = {
  outstanding: '1339488.25',
  overdueOutstanding: '248750.00',
  advances: INDEXES.map((i) => ({
    id: `advance-${i}`,
    requestNumber: `CA-2026-00${i}12`,
    memberId: `member-${i}`,
    memberName: name(i),
    amount: amount(i),
    purpose: 'Travel and lodging for the National Fire Academy Executive Fire Officer Program in Emmitsburg',
    checkNumber: '0004812',
    issuedAt: '2026-06-14T15:00:00Z',
    dueAt: '2026-10-12T15:00:00Z',
    accounted: '123456.78',
    returned: '23456.78',
    outstanding: '101543.22',
    overdue: i !== 1,
  })),
};

const LATE_SUBSTANTIATION = {
  start: '2026-11-01',
  end: '2026-11-05',
  total: '1339488.25',
  rows: INDEXES.map((i) => ({
    paidOn: '2026-11-03',
    reportId: `expense-${i}`,
    reportNumber: `ER-2026-00${i}45`,
    memberName: name(i),
    description: 'Hotel, meals and mileage for the state fire instructor recertification conference in Harrisburg',
    budgetLine: line(i),
    incurredOn: '2026-07-14',
    submittedOn: '2026-10-28',
    daysToSubmit: 106,
    amount: amount(i),
    acknowledgedByName: name(i + 1),
  })),
};

// One member in each state a row can show, so every row action is drawn.
const MEMBER_DUES = (['paid', 'partial', 'overdue', 'waived'] as const).map((status, i) => ({
  id: `dues-${i}`,
  organizationId: 'e2e-org',
  duesScheduleId: 'e2e-dues-schedule',
  userId: `member-${i}`,
  amountDue: '125000.00',
  amountPaid: ['125000.00', '62500.00', '0.00', '0.00'][i],
  status,
  dueDate: '2026-03-01T05:00:00Z',
  ...(status === 'paid' ? { paidDate: '2026-02-10T15:00:00Z', paymentMethod: 'check' } : {}),
  ...(status === 'waived' ? { waivedAt: '2026-01-15T15:00:00Z', waiveReason: 'Life member' } : {}),
  memberName: [...NAMES, 'Bartholomew Ravensworth-Delacroix'][i],
  createdAt: '2026-01-02T15:00:00Z',
  updatedAt: '2026-02-10T15:00:00Z',
}));

// Complete and not yet imported, interrupted, and imported: every "In QuickBooks" state.
const EXPORT_LOGS = INDEXES.map((i) => ({
  id: `export-${i}`,
  organizationId: 'e2e-org',
  exportType: 'transactions',
  dateRangeStart: '2026-09-01T05:00:00Z',
  dateRangeEnd: '2026-09-30T05:00:00Z',
  recordCount: 12847,
  fileFormat: 'csv',
  exportedBy: `member-${i}`,
  exportedByName: name(i),
  exportedAt: '2026-10-02T15:00:00Z',
  status: ['successful', 'partial', 'successful'][i],
  errorMessage: null,
  importedAt: i === 2 ? '2026-10-03T15:00:00Z' : null,
  importedByName: i === 2 ? name(0) : null,
}));

// =============================================================================
// Helpers
// =============================================================================

/** Match the path alone, so a query string never decides which fixture answers. */
const atPath = (path: string) => (url: URL) => url.pathname === path;

async function serve(page: Page, path: string, body: unknown): Promise<void> {
  await page.route(atPath(path), (route) => void route.fulfill(json(body)));
}

const tableWithHeader = (page: Page, header: string) =>
  page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: header, exact: true }) });

async function serveReports(page: Page): Promise<void> {
  await serve(page, '/api/v1/finance/fiscal-years', [FISCAL_YEAR]);
  await serve(page, '/api/v1/finance/reports/budget-vs-actual', BUDGET_VS_ACTUAL);
  await serve(page, '/api/v1/finance/reports/amendment-log', AMENDMENT_LOG);
  await serve(page, '/api/v1/finance/reports/payments-register', PAYMENTS_REGISTER);
  await serve(page, '/api/v1/finance/reports/advances', ADVANCES);
  await serve(page, '/api/v1/finance/reports/late-substantiation', LATE_SUBSTANTIATION);
}

async function serveApprovals(page: Page): Promise<void> {
  await serve(page, '/api/v1/finance/approvals/pending', PENDING_APPROVALS);
  await serve(page, '/api/v1/finance/approvals/unrouted', UNROUTED_APPROVALS);
}

// =============================================================================
// Tests
// =============================================================================

// The Treasurer's review of next year's budget requests: ten columns, five of
// them money, plus a Review/Change action on every decided row.
test.describe('Budget request review table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/budget-requests/review — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await serve(page, '/api/v1/finance/fiscal-years/options', [{ ...FISCAL_YEAR, status: 'draft' }]);
      await serve(page, '/api/v1/finance/budget-requests', BUDGET_REQUESTS);
      await page.goto('/finance/budget-requests/review');
      // The Treasurer lands on Submitted; All shows every row state.
      await page.locator('#review-status').selectOption('all');
      const table = tableWithHeader(page, 'This year spent');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Budget request review table');
    });
  }
});

// Approval steps waiting on the viewer: long request titles with late-line and
// fund-shortfall badges, email-link status, and Approve/Deny buttons.
test.describe('Pending approvals table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/approvals — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await serveApprovals(page);
      await page.goto('/finance/approvals');
      const table = tableWithHeader(page, 'Waiting on');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Pending approvals table');
    });
  }
});

// Requests no chain routes, decided on their own page: the "Needs" column
// spells out what each one is waiting for.
test.describe('Manual decisions table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/approvals manual decisions — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await serveApprovals(page);
      await page.goto('/finance/approvals');
      const table = tableWithHeader(page, 'Needs');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Manual decisions table');
    });
  }
});

// The finance reports: each a board-facing table of long budget-line names and
// money columns, reached by the report's `?report=` key.
const REPORTS = [
  { key: 'budget-vs-actual', header: 'Original', label: 'Budget vs actual table' },
  { key: 'amendment-log', header: 'Approved by', label: 'Amendment log table' },
  { key: 'payments-register', header: 'Payee', label: 'Payments register table' },
  { key: 'advances', header: 'Accounted for', label: 'Cash advances table' },
  { key: 'late-substantiation', header: 'Confirmed by', label: 'Outside the accountable plan table' },
] as const;

for (const report of REPORTS) {
  test.describe(report.label, () => {
    for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
      test(`/finance/reports?report=${report.key} — ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await signIn(page, { permissions: PERMISSIONS });
        await serveReports(page);
        await page.goto(`/finance/reports?report=${report.key}`);
        const table = tableWithHeader(page, report.header);
        await table.waitFor();
        await expectTableFitsItsCard(table, report.label);
      });
    }
  });
}

// Member dues: the member name never wraps, and an owing row carries both
// Record payment and Waive.
test.describe('Member dues table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/dues — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await serve(page, '/api/v1/finance/dues', MEMBER_DUES);
      await page.goto('/finance/dues');
      const table = tableWithHeader(page, 'Amount Due');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Member dues table');
    });
  }
});

// QuickBooks export history: date-time, period, status with its hint, and the
// "Mark as imported" button.
test.describe('QuickBooks export history table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/finance/settings/quickbooks — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await serve(page, '/api/v1/finance/export/readiness', { categories: [], unmatchedMappingIds: [] });
      await serve(page, '/api/v1/finance/export/mappings', []);
      await serve(page, '/api/v1/finance/export/logs', EXPORT_LOGS);
      await page.goto('/finance/settings/quickbooks');
      const table = tableWithHeader(page, 'In QuickBooks');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'QuickBooks export history table');
    });
  }
});
