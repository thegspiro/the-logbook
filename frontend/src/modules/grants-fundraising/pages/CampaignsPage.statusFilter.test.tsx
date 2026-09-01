/**
 * Regression test: the dashboard's "Active Campaigns" KPI card links to
 * `/grants/campaigns?status=active`, but this page never read the query
 * string — `statusFilter` always started `''`, so the link silently landed
 * on the unfiltered list instead of the filtered one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockCheckPermission = vi.fn();
const mockListCampaigns = vi.fn();

vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../services/api', () => ({
  fundraisingService: {
    listCampaigns: (...args: unknown[]) => mockListCampaigns(...args) as unknown,
  },
}));

import CampaignsPage from './CampaignsPage';

describe('CampaignsPage — status filter from the URL', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
    mockListCampaigns.mockReset();
    mockListCampaigns.mockResolvedValue([]);
  });

  it('applies ?status=active from the dashboard link as the initial filter', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/campaigns?status=active']}>
        <CampaignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockListCampaigns).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  it('loads every campaign when no status is in the URL', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/campaigns']}>
        <CampaignsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockListCampaigns).toHaveBeenCalledWith({});
    });
  });

  it('falls back to unfiltered when the URL carries a status this page does not recognize', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/campaigns?status=archived']}>
        <CampaignsPage />
      </MemoryRouter>
    );

    // A stale bookmark or a typo should not silently apply a filter that
    // matches nothing — it should behave like no filter was given at all.
    await waitFor(() => {
      expect(mockListCampaigns).toHaveBeenCalledWith({});
    });
  });
});
