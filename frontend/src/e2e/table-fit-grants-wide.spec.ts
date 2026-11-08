import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [
  ...TEST_USER.permissions,
  'fundraising.view',
  'fundraising.manage',
  'grants.view',
  'grants.manage',
];
const CREATED = '2026-10-14T15:30:00Z';

const DONOR_NAMES: [string, string][] = [
  ['Alexandra', 'Ayala-Montgomery'],
  ['Christopher', 'Fitzgerald-Whitaker'],
  ['Maximiliana', 'Rodriguez-Vandenberg'],
  ['Bartholomew', 'Okonkwo-Henderson'],
];

const donors = DONOR_NAMES.map(([firstName, lastName], i) => ({
  id: `donor-${i}`,
  organizationId: 'org-1',
  userId: null,
  firstName,
  lastName,
  email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@northwesterncommunityfoundation.org`,
  phone: '555-201-4455',
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  donorType: 'foundation',
  companyName: 'Northwestern Community Foundation for Public Safety',
  totalDonated: 248750.5,
  donationCount: 128,
  firstDonationDate: '2019-03-14',
  lastDonationDate: '2026-10-02',
  notes: null,
  tags: null,
  communicationPreferences: null,
  isAnonymous: false,
  active: true,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

const donations = DONOR_NAMES.map(([firstName, lastName], i) => ({
  id: `donation-${i}`,
  organizationId: 'org-1',
  campaignId: null,
  donorId: null,
  amount: 124850.0,
  currency: 'USD',
  donationDate: '2026-10-02T14:00:00Z',
  paymentMethod: 'bank_transfer',
  paymentStatus: 'completed',
  transactionId: null,
  checkNumber: null,
  isRecurring: true,
  recurringFrequency: 'monthly',
  isAnonymous: false,
  donorName: `${firstName} ${lastName}`,
  donorEmail: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@northwesternfoundation.org`,
  dedicationType: 'in_memory',
  dedicationName: 'Captain Bartholomew Fitzgerald-Hernandez',
  notes: null,
  receiptSent: true,
  thankYouSent: true,
  taxDeductible: true,
  recordedBy: null,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

const GRANT_BUDGET_CATEGORIES = ['equipment', 'personnel', 'training', 'contractual'];

const grantApplication = {
  id: 'grant-1',
  organizationId: 'org-1',
  opportunityId: null,
  grantProgramName: 'Assistance to Firefighters Grant (AFG) — Operations and Safety',
  grantAgency: 'Federal Emergency Management Agency',
  applicationStatus: 'awarded',
  amountRequested: 845000,
  amountAwarded: 812500,
  matchAmount: 81250,
  matchSource: null,
  applicationDeadline: '2026-02-01',
  submittedDate: '2026-01-20',
  awardDate: '2026-06-01',
  grantStartDate: '2026-07-01',
  grantEndDate: '2027-06-30',
  projectDescription: null,
  narrativeSummary: null,
  budgetSummary: null,
  keyContacts: null,
  federalAwardId: 'EMW-2026-FG-01234',
  nfirsCompliant: true,
  performancePeriodMonths: 12,
  reportingFrequency: null,
  nextReportDue: null,
  finalReportDue: null,
  assignedTo: null,
  priority: 'high',
  linkedCampaignId: null,
  notes: null,
  createdBy: null,
  createdAt: '2026-01-20T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  allowedNextStatuses: [],
  totalExpended: '573003.20',
  overspentBy: null,
  budgetItems: GRANT_BUDGET_CATEGORIES.map((category, i) => ({
    id: `budget-item-${i}`,
    applicationId: 'grant-1',
    category,
    description: 'Self-contained breathing apparatus packs, spare cylinders and RIT bags for all front-line engines',
    amountBudgeted: '284500.00',
    amountSpent: '143250.80',
    federalShare: null,
    localMatch: null,
    notes: null,
    sortOrder: i,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    overspentBy: null,
  })),
  expenditures: GRANT_BUDGET_CATEGORIES.map((_, i) => ({
    id: `expenditure-${i}`,
    applicationId: 'grant-1',
    budgetItemId: `budget-item-${i}`,
    description: 'First delivery of SCBA packs with integrated PASS devices and voice amplifiers, invoice 2 of 4',
    amount: '143250.80',
    expenditureDate: '2026-09-15',
    vendor: 'Municipal Emergency Services Equipment Distributors LLC',
    invoiceNumber: 'INV-884213',
    receiptUrl: 'https://example.com/receipts/inv-884213.pdf',
    paymentMethod: null,
    approvedBy: null,
    approvalDate: null,
    notes: null,
    createdBy: null,
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
  })),
  complianceTasks: [],
  grantNotes: [],
};

// The donations list: date, donor with email, a six-digit recurring amount,
// method, status, receipt, a long dedication and an edit action.
test.describe('Donations table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/grants/donations — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/grants/donations**', (route) => void route.fulfill(json(donations)));
      await page.route('**/api/v1/grants/donors**', (route) => void route.fulfill(json(donors)));
      await page.goto('/grants/donations');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Dedication', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Donations table');
    });
  }
});

// The donor directory: name with company, a long email, type, total, count,
// last donation and email/phone actions.
test.describe('Donors table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/grants/donors — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/grants/donors**', (route) => void route.fulfill(json(donors)));
      await page.goto('/grants/donors');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Total Donated', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Donors table');
    });
  }
});

// A grant's Expenditures tab: date, a long description, a long vendor kept on
// one line, a six-digit amount, the budget category, receipt and actions.
test.describe('Grant expenditures table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/grants/applications/:id Expenditures tab — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/grants/applications/grant-1', (route) => void route.fulfill(json(grantApplication)));
      await page.goto('/grants/applications/grant-1');
      await page.getByRole('button', { name: 'Expenditures', exact: true }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Budget Category', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Grant expenditures table');
    });
  }
});
