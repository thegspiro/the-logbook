import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const DONOR_NAMES: [string, string][] = [
  ['Alexandra', 'Ayala-Montgomery'],
  ['Christopher', 'Fitzgerald-Whitaker'],
  ['Maximiliana', 'Rodriguez-Vandenberg'],
  ['Bartholomew', 'Okonkwo-Henderson'],
];

const PLEDGE_STATUSES = ['pending', 'partial', 'fulfilled', 'cancelled'];

const donors = DONOR_NAMES.map(([firstName, lastName], i) => ({
  id: `donor-${i}`,
  organizationId: 'org-1',
  userId: null,
  firstName,
  lastName,
  email: null,
  phone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  donorType: 'individual',
  companyName: 'Montgomery Family Charitable Foundation',
  totalDonated: 0,
  donationCount: 0,
  firstDonationDate: null,
  lastDonationDate: null,
  notes: null,
  tags: null,
  communicationPreferences: null,
  isAnonymous: false,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}));

const campaigns = DONOR_NAMES.map((_, i) => ({
  id: `campaign-${i}`,
  organizationId: 'org-1',
  name: 'New Tanker and Rescue Apparatus Replacement Capital Campaign 2026',
  description: null,
  campaignType: 'equipment',
  goalAmount: 950000,
  currentAmount: 123456,
  startDate: '2026-01-01',
  endDate: null,
  status: 'active',
  publicPageEnabled: false,
  publicPageUrl: null,
  heroImageUrl: null,
  thankYouMessage: null,
  allowAnonymous: true,
  minimumDonation: null,
  suggestedAmounts: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}));

const pledges = DONOR_NAMES.map((_, i) => ({
  id: `pledge-${i}`,
  organizationId: 'org-1',
  campaignId: `campaign-${i}`,
  donorId: `donor-${i}`,
  pledgedAmount: '987654.32',
  fulfilledAmount: '123456.78',
  pledgeDate: '2026-02-14',
  dueDate: '2026-12-31',
  status: PLEDGE_STATUSES[i] ?? 'pending',
  paymentSchedule: null,
  reminderEnabled: false,
  notes: null,
  createdBy: null,
  createdAt: '2026-02-14T00:00:00Z',
  updatedAt: '2026-02-14T00:00:00Z',
}));

// The pledges list: donor with company and pledge date, campaign, three
// six-digit amounts, due date, status and an edit action. Wide enough to
// overflow its card on a tablet with the side navigation open.
test.describe('Pledges table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/grants/pledges — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, {
        permissions: [
          ...TEST_USER.permissions,
          'fundraising.view',
          'fundraising.manage',
          'grants.view',
          'grants.manage',
        ],
      });
      await page.route('**/api/v1/grants/pledges**', (route) => void route.fulfill(json(pledges)));
      await page.route('**/api/v1/grants/donors**', (route) => void route.fulfill(json(donors)));
      await page.route('**/api/v1/grants/campaigns**', (route) => void route.fulfill(json(campaigns)));
      await page.goto('/grants/pledges');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Remaining', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Pledges table');
    });
  }
});

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
  totalExpended: '693003.00',
  overspentBy: null,
  budgetItems: GRANT_BUDGET_CATEGORIES.map((category, i) => ({
    id: `budget-item-${i}`,
    applicationId: 'grant-1',
    category,
    description: 'Self-contained breathing apparatus packs, spare cylinders and RIT bags for all front-line engines',
    amountBudgeted: '284500.00',
    amountSpent: '173250.75',
    federalShare: null,
    localMatch: null,
    notes: null,
    sortOrder: i,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    overspentBy: null,
  })),
  expenditures: [],
  complianceTasks: [],
  grantNotes: [],
};

// A grant's Budget tab: category, a long line description, three six-digit
// amounts, a progress bar, edit/delete actions and a totals footer.
test.describe('Grant budget table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/grants/applications/:id Budget tab — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, {
        permissions: [
          ...TEST_USER.permissions,
          'fundraising.view',
          'fundraising.manage',
          'grants.view',
          'grants.manage',
        ],
      });
      await page.route('**/api/v1/grants/applications/grant-1', (route) => void route.fulfill(json(grantApplication)));
      await page.goto('/grants/applications/grant-1');
      await page.getByRole('button', { name: 'Budget', exact: true }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Progress', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Grant budget table');
    });
  }
});
