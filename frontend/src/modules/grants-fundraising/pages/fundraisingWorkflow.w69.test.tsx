/**
 * Workflow review W69: campaigns, donors, donations and reports, as the
 * treasurer.
 *
 * - A campaign created as Active was stored as Draft, had no end date, and
 *   nothing could change its status afterwards.
 * - Donations from a directory donor read "Unknown", the status showed its raw
 *   code, and a failed load read "No donations recorded yet."
 * - The donor form's labels were not tied to their fields.
 * - The dashboard's "Total Raised (12mo)" read $0: the API sends
 *   `totalRaised12Mo`.
 * - Reports' monthly table printed "2026-10".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { createMockApiError } from '@/test/utils';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

const {
  listCampaigns,
  createCampaign,
  updateCampaign,
  listDonations,
  listDonors,
  createDonor,
  getGrantReport,
  getFundraisingReport,
  storeState,
} = vi.hoisted(() => {
  const state: { current: Record<string, unknown> } = { current: {} };
  return {
    listCampaigns: vi.fn(),
    createCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    listDonations: vi.fn(),
    listDonors: vi.fn(),
    createDonor: vi.fn(),
    getGrantReport: vi.fn(),
    getFundraisingReport: vi.fn(),
    storeState: state,
  };
});

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: () => true };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
vi.mock('../store/grantsStore', () => ({ useGrantsStore: () => storeState.current }));
vi.mock('../services/api', () => ({
  fundraisingService: {
    listCampaigns: (...a: unknown[]) => listCampaigns(...a) as unknown,
    createCampaign: (...a: unknown[]) => createCampaign(...a) as unknown,
    updateCampaign: (...a: unknown[]) => updateCampaign(...a) as unknown,
    listDonations: (...a: unknown[]) => listDonations(...a) as unknown,
    listDonors: (...a: unknown[]) => listDonors(...a) as unknown,
    createDonor: (...a: unknown[]) => createDonor(...a) as unknown,
  },
  grantsService: {
    getGrantReport: (...a: unknown[]) => getGrantReport(...a) as unknown,
    getFundraisingReport: (...a: unknown[]) => getFundraisingReport(...a) as unknown,
  },
}));

import CampaignsPage from './CampaignsPage';
import DonationsPage from './DonationsPage';
import DonorsPage from './DonorsPage';
import GrantsDashboardPage from './GrantsDashboardPage';
import GrantsReportsPage from './GrantsReportsPage';

const CAMPAIGN = {
  id: 'c1',
  name: 'Thermal Camera Drive',
  campaignType: 'equipment',
  status: 'draft',
  goalAmount: '25000.00',
  currentAmount: '3000.00',
  startDate: '2026-10-01',
  endDate: null,
  isRestricted: false,
  restrictionPurpose: null,
};

const DONOR = {
  id: 'd1',
  firstName: 'Dale',
  lastName: 'Harmon',
  companyName: 'Valley Hardware',
  donorType: 'business',
  totalDonated: '2500.00',
  donationCount: 1,
};

beforeEach(() => {
  for (const mock of [
    listCampaigns,
    createCampaign,
    updateCampaign,
    listDonations,
    listDonors,
    createDonor,
    getGrantReport,
    getFundraisingReport,
  ]) {
    mock.mockReset();
  }
  listCampaigns.mockResolvedValue([CAMPAIGN]);
  createCampaign.mockResolvedValue({});
  updateCampaign.mockResolvedValue({});
  listDonors.mockResolvedValue([DONOR]);
  createDonor.mockResolvedValue({});
  listDonations.mockResolvedValue([
    {
      id: 'g1',
      amount: '2500.00',
      donationDate: '2026-10-10T05:00:00Z',
      paymentMethod: 'bank_transfer',
      paymentStatus: 'completed',
      donorId: 'd1',
      donorName: null,
      donorEmail: null,
      isAnonymous: false,
    },
  ]);
});

const renderAt = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </MemoryRouter>
  );

describe('Campaigns (W69)', () => {
  it('creates a campaign with the status and end date chosen', async () => {
    // No cards, so the form's Status is the only one on the page.
    listCampaigns.mockResolvedValue([]);
    const user = userEvent.setup();
    renderAt(<CampaignsPage />);

    await user.click(await screen.findByRole('button', { name: 'New Campaign' }));
    await user.type(screen.getByLabelText(/^Name/), 'Pancake Breakfast 2026');
    await user.type(screen.getByLabelText(/^Goal Amount/), '3000');
    await user.type(screen.getByLabelText(/^Start Date/), '2026-11-01');
    await user.type(screen.getByLabelText('End Date'), '2026-11-08');
    await user.selectOptions(screen.getByLabelText('Status'), 'active');
    await user.click(screen.getByRole('button', { name: 'Create Campaign' }));

    await waitFor(() => expect(createCampaign).toHaveBeenCalled());
    expect(createCampaign.mock.calls[0]?.[0]).toMatchObject({ status: 'active', endDate: '2026-11-08' });
  });

  it("changes a campaign's status from its card", async () => {
    const user = userEvent.setup();
    renderAt(<CampaignsPage />);

    await user.selectOptions(await screen.findByLabelText('Status'), 'completed');

    await waitFor(() => expect(updateCampaign).toHaveBeenCalledWith('c1', { status: 'completed' }));
  });
});

describe('Donations (W69)', () => {
  it('names a directory donor and labels the status', async () => {
    renderAt(<DonationsPage />);

    expect(await screen.findByText('Dale Harmon (Valley Hardware)')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  it('says the load failed rather than that there are no donations', async () => {
    listDonations.mockRejectedValue(createMockApiError('Service unavailable', 503));
    renderAt(<DonationsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    expect(screen.queryByText('No donations recorded yet.')).not.toBeInTheDocument();
  });
});

describe('Donors (W69)', () => {
  it('ties each label to its field', async () => {
    const user = userEvent.setup();
    renderAt(<DonorsPage />);

    await user.click(await screen.findByRole('button', { name: 'Add Donor' }));
    await user.type(screen.getByLabelText(/First Name/), 'Maria');
    await user.type(screen.getByLabelText(/Last Name/), 'Lopez');
    await user.type(screen.getByLabelText('Email'), 'maria@example.com');
    await user.click(screen.getByRole('button', { name: 'Save Donor' }));

    await waitFor(() => expect(createDonor).toHaveBeenCalled());
    expect(createDonor.mock.calls[0]?.[0]).toMatchObject({
      firstName: 'Maria',
      lastName: 'Lopez',
      email: 'maria@example.com',
    });
  });

  describe('an organization by its name alone (W69-6)', () => {
    it('saves a business with no contact name', async () => {
      const user = userEvent.setup();
      renderAt(<DonorsPage />);

      await user.click(await screen.findByRole('button', { name: 'Add Donor' }));
      await user.selectOptions(screen.getByLabelText('Donor Type'), 'foundation');
      await user.type(screen.getByLabelText('Organization Name'), 'County Fire Foundation');
      await user.click(screen.getByRole('button', { name: 'Save Donor' }));

      await waitFor(() => expect(createDonor).toHaveBeenCalled());
      expect(createDonor.mock.calls[0]?.[0]).toMatchObject({
        firstName: null,
        lastName: null,
        donorType: 'foundation',
        companyName: 'County Fire Foundation',
      });
    });

    it('still needs both names for an individual', async () => {
      const user = userEvent.setup();
      renderAt(<DonorsPage />);

      await user.click(await screen.findByRole('button', { name: 'Add Donor' }));
      expect(screen.queryByLabelText('Organization Name')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/First Name/)).toBeRequired();
      await user.selectOptions(screen.getByLabelText('Donor Type'), 'business');
      expect(screen.getByLabelText(/First Name/)).not.toBeRequired();
    });

    it('lists the organization by its own name', async () => {
      listDonors.mockResolvedValue([
        { ...DONOR, firstName: null, lastName: null, companyName: 'Main Street Bakery', email: 'hi@bakery.test' },
      ]);
      renderAt(<DonorsPage />);

      expect(await screen.findByText('Main Street Bakery')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Email Main Street Bakery' })).toBeInTheDocument();
    });
  });

  it('names the email link after the donor', async () => {
    listDonors.mockResolvedValue([{ ...DONOR, email: 'dale@example.com' }]);
    renderAt(<DonorsPage />);

    expect(await screen.findByRole('link', { name: 'Email Dale Harmon' })).toHaveAttribute(
      'href',
      'mailto:dale@example.com'
    );
  });
});

describe('Dashboard and reports (W69)', () => {
  it('shows the twelve-month total the API sends', () => {
    storeState.current = {
      dashboard: {
        activeGrants: 0,
        pendingApplications: 0,
        totalGrantFunding: 0,
        totalRaisedYtd: '3000.0',
        totalRaised12Mo: '3250.0',
        activeCampaignsCount: 0,
        activeCampaigns: [],
        recentDonations: [],
        upcomingDeadlines: [],
        complianceTasksDue: [],
        outstandingPledges: 0,
        totalDonors: 0,
        pipelineSummary: [],
      },
      isLoading: false,
      error: null,
      fetchDashboard: () => Promise.resolve(),
      clearError: () => undefined,
    };
    renderAt(<GrantsDashboardPage />);

    expect(screen.getByText('$3,250')).toBeInTheDocument();
  });

  it('names the months in the monthly totals', async () => {
    getGrantReport.mockResolvedValue({
      totalApplications: 0,
      totalRequested: 0,
      totalAwarded: 0,
      totalSpent: 0,
      successRate: 0,
      awardedCount: 0,
      deniedCount: 0,
      complianceSummary: { totalTasks: 0, completed: 0, overdue: 0, pending: 0 },
      spendingByCategory: {},
    });
    getFundraisingReport.mockResolvedValue({
      totalDonations: '3000.0',
      donationCount: 2,
      uniqueDonors: 2,
      averageGift: '1500.0',
      donationsByMethod: {},
      monthlyTotals: [{ month: '2026-10', total: 3000 }],
    });
    const user = userEvent.setup();
    renderAt(<GrantsReportsPage />);

    await user.click(await screen.findByRole('button', { name: 'Fundraising' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('October 2026')).toBeInTheDocument();
  });
});
