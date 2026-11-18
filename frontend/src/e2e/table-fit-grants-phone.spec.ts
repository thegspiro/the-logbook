import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [
  ...TEST_USER.permissions,
  'fundraising.view',
  'fundraising.manage',
  'grants.view',
  'grants.manage',
];
const CREATED = '2026-01-01T00:00:00Z';

const applications = [0, 1, 2, 3].map((i) => ({
  id: `grant-${i}`,
  organizationId: 'org-1',
  opportunityId: null,
  grantProgramName: 'Assistance to Firefighters Grant — Operations and Safety: SCBA Replacement',
  grantAgency: 'Federal Emergency Management Agency, U.S. Department of Homeland Security',
  applicationStatus: 'submitted',
  amountRequested: 987654,
  amountAwarded: 876543,
  matchAmount: null,
  matchSource: null,
  applicationDeadline: '2026-12-31',
  submittedDate: null,
  awardDate: null,
  grantStartDate: null,
  grantEndDate: null,
  projectDescription: null,
  narrativeSummary: null,
  budgetSummary: null,
  keyContacts: null,
  federalAwardId: null,
  nfirsCompliant: null,
  performancePeriodMonths: null,
  reportingFrequency: null,
  nextReportDue: null,
  finalReportDue: null,
  assignedTo: TEST_USER.id,
  priority: 'critical',
  linkedCampaignId: null,
  notes: null,
  createdBy: null,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

const recentDonations = [0, 1, 2, 3].map((i) => ({
  id: `donation-${i}`,
  organizationId: 'org-1',
  campaignId: 'campaign-1',
  donorId: `donor-${i}`,
  pledgeId: null,
  amount: 987654,
  currency: 'USD',
  donationDate: '2026-02-14',
  paymentMethod: 'bank_transfer',
  paymentStatus: 'completed',
  transactionId: null,
  checkNumber: null,
  isRecurring: false,
  recurringFrequency: null,
  isAnonymous: false,
  donorName: 'Montgomery Family Charitable Foundation of Greater Northfield',
  donorEmail: null,
  dedicationType: null,
  dedicationName: null,
  notes: null,
  receiptSent: true,
  thankYouSent: true,
  taxDeductible: true,
  recordedBy: null,
  createdAt: CREATED,
  updatedAt: CREATED,
}));

const dashboard = {
  activeGrants: 4,
  pendingApplications: 2,
  totalGrantFunding: 987654,
  totalRaisedYtd: 123456,
  totalRaised12Mo: 234567,
  activeCampaignsCount: 0,
  activeCampaigns: [],
  recentDonations,
  upcomingDeadlines: [],
  complianceTasksDue: [],
  outstandingPledges: 0,
  totalDonors: 4,
  pipelineSummary: [],
};

const VIEWPORTS = [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS];

async function signInToGrants(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await signIn(page, { permissions: PERMISSIONS });
}

// The applications table view: a long program name and agency, a status
// badge, two six-digit amounts, deadline, priority, assignee and a link icon.
test.describe('Grant applications table fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/grants/applications (Table) — ${viewport.name}`, async ({ page }) => {
      await signInToGrants(page, viewport);
      await page.route('**/api/v1/grants/applications**', (route) => void route.fulfill(json(applications)));
      await page.goto('/grants/applications');
      await page.getByRole('button', { name: 'Table', exact: true }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: /Amount Awarded/ }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Grant applications table');
    });
  }
});

// The dashboard's recent donations: date, a long donor name, a six-digit
// amount, a campaign link and the payment method.
test.describe('Recent donations table fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/grants (Recent Donations) — ${viewport.name}`, async ({ page }) => {
      await signInToGrants(page, viewport);
      await page.route('**/api/v1/grants/dashboard**', (route) => void route.fulfill(json(dashboard)));
      await page.goto('/grants');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Method', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Recent donations table');
    });
  }
});
