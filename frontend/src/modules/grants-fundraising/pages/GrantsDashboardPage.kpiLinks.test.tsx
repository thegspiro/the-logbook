/**
 * GF-27a: a KPI card that counts several statuses links to the same set.
 * "Active Grants" counts active and reporting, "Pending Applications" five
 * pre-decision statuses, and "Total Grant Funding" the awarded-through-closed
 * statuses — each now opens the applications list on that named group rather
 * than on one status (or on everything).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => false }),
}));

const dashboard = {
  activeGrants: 3,
  pendingApplications: 5,
  totalGrantFunding: 100000,
  totalRaisedYtd: 0,
  totalRaised12Mo: 0,
  activeCampaignsCount: 0,
  activeCampaigns: [],
  recentDonations: [],
  upcomingDeadlines: [],
  complianceTasksDue: [],
  outstandingPledges: 0,
  totalDonors: 0,
  pipelineSummary: [],
};
vi.mock('../store/grantsStore', () => ({
  useGrantsStore: () => ({
    dashboard,
    isLoading: false,
    error: null,
    fetchDashboard: () => Promise.resolve(),
    clearError: () => undefined,
  }),
}));

import GrantsDashboardPage from './GrantsDashboardPage';

describe('Grants dashboard KPI links', () => {
  it.each([
    [/active grants/i, '/grants/applications?group=active'],
    [/pending applications/i, '/grants/applications?group=pending'],
    [/total grant funding/i, '/grants/applications?group=funded'],
  ])('%s opens the group it counts', (name, href) => {
    render(
      <MemoryRouter>
        <GrantsDashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  });
});
