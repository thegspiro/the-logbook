/**
 * Regression test: `GrantApplicationsPage` fetched applications once on
 * mount with no params (server default `limit: 100`) and then filtered by
 * status **client-side** against that single capped, unfiltered page. A
 * dashboard KPI/pipeline `?status=<value>` deep link (or the page's own
 * status dropdown) could therefore silently omit a matching application
 * older than the newest 100, even though the dashboard's own KPI count —
 * which is not capped — included it. Status is now passed to the
 * server-side fetch and re-fetched whenever it changes.
 *
 * Also covers a follow-on finding on that same fix: passing `status`
 * server-side still left the fetch capped at the backend's 100-row
 * default, just per-status instead of overall. The page has no pagination
 * UI, so it now asks for the backend's own maximum (`limit: 1000`) on
 * every fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockFetchApplications = vi.fn();

vi.mock('../store/grantsStore', () => ({
  useGrantsStore: () => ({
    applications: [],
    isLoading: false,
    error: null,
    fetchApplications: (...args: unknown[]) => mockFetchApplications(...args) as unknown,
  }),
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { GrantApplicationsPage } from './GrantApplicationsPage';

describe('GrantApplicationsPage — status filter is server-side', () => {
  beforeEach(() => {
    mockFetchApplications.mockReset();
  });

  it('passes ?status=active from the dashboard link to the server-side fetch', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/applications?status=active']}>
        <GrantApplicationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockFetchApplications).toHaveBeenCalledWith({ status: 'active', limit: 1000 });
    });
  });

  it('fetches every status, uncapped, when the URL carries no status', async () => {
    render(
      <MemoryRouter initialEntries={['/grants/applications']}>
        <GrantApplicationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockFetchApplications).toHaveBeenCalledWith({ limit: 1000 });
    });
  });
});
