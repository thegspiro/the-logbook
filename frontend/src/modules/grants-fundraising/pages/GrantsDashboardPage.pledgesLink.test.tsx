/**
 * The Outstanding Pledges tile lost its link while /grants/pledges had no
 * route (a click bounced to the home dashboard). The pledges page exists now,
 * so the tile links to it again.
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
  activeGrants: 0,
  pendingApplications: 0,
  totalGrantFunding: 0,
  totalRaisedYtd: 0,
  totalRaised12Mo: 0,
  activeCampaignsCount: 0,
  activeCampaigns: [],
  recentDonations: [],
  upcomingDeadlines: [],
  complianceTasksDue: [],
  outstandingPledges: 1250,
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

describe('Outstanding Pledges tile', () => {
  it('links to the pledges page', () => {
    render(
      <MemoryRouter>
        <GrantsDashboardPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /outstanding pledges/i })).toHaveAttribute('href', '/grants/pledges');
  });
});
