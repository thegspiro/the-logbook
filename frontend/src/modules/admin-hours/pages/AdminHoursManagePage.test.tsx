import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { AdminHoursEntry } from '../types';

const mockListAll = vi.fn();
const mockListCategories = vi.fn();
const mockGetPendingCount = vi.fn();
const mockListActiveSessions = vi.fn();

vi.mock('../services/api', () => ({
  adminHoursCategoryService: {
    list: (...a: unknown[]) => mockListCategories(...a) as unknown,
  },
  adminHoursClockService: {},
  adminHoursEntryService: {
    listAll: (...a: unknown[]) => mockListAll(...a) as unknown,
    getPendingCount: (...a: unknown[]) => mockGetPendingCount(...a) as unknown,
    listActiveSessions: (...a: unknown[]) => mockListActiveSessions(...a) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

// Out of scope here: only which tab opens, and what Pending Review lists.
vi.mock('../components/CategoriesTab', () => ({ default: () => <div>categories-tab</div> }));
vi.mock('../components/ActiveSessionsTab', () => ({ default: () => <div>active-sessions-tab</div> }));
vi.mock('../components/AllEntriesTab', () => ({ default: () => <div>all-entries-tab</div> }));
vi.mock('../components/SummaryTab', () => ({ default: () => <div>summary-tab</div> }));
vi.mock('../components/ReviewRulesTab', () => ({ default: () => <div>review-rules-tab</div> }));

import AdminHoursManagePage from './AdminHoursManagePage';
import { useAdminHoursStore } from '../store/adminHoursStore';

const entry = (overrides: Partial<AdminHoursEntry> = {}): AdminHoursEntry => ({
  id: 'e-1',
  organizationId: 'org-1',
  userId: 'u-1',
  categoryId: 'cat-1',
  clockInAt: '2026-10-14T23:30:00Z',
  clockOutAt: '2026-10-15T01:30:00Z',
  durationMinutes: 120,
  description: null,
  entryMethod: 'manual',
  status: 'pending',
  approvedBy: null,
  approvedAt: null,
  rejectionReason: null,
  sourceEventId: null,
  sourceRsvpId: null,
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
  categoryName: 'Station Maintenance',
  categoryColor: null,
  userName: 'Jordan Avery',
  approverName: null,
  sourceEventName: null,
  ...overrides,
});

describe("AdminHoursManagePage — the dashboard tile's ?status=pending", () => {
  beforeEach(() => {
    useAdminHoursStore.setState({ allEntries: [], allEntriesTotal: 0, error: null });
    // The server owns the status filter; answering by it is what proves the
    // page asked for the pending rows rather than every entry.
    mockListAll.mockReset();
    mockListAll.mockImplementation((params?: { status?: string }) =>
      Promise.resolve(
        params?.status === 'pending'
          ? { entries: [entry()], total: 1 }
          : {
              entries: [entry(), entry({ id: 'e-2', status: 'approved', userName: 'Sam Ortiz' })],
              total: 2,
            }
      )
    );
    mockListCategories.mockReset();
    mockListCategories.mockResolvedValue([]);
    mockGetPendingCount.mockReset();
    mockGetPendingCount.mockResolvedValue(1);
    mockListActiveSessions.mockReset();
    mockListActiveSessions.mockResolvedValue([]);
  });

  // renderWithRouter mounts a BrowserRouter, which reads window.location, so
  // the URL is the fixture and has to be put back for the tests after this.
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  const renderAt = (url: string) => {
    window.history.pushState({}, '', url);
    return renderWithRouter(<AdminHoursManagePage />);
  };

  it('opens on Pending Review, listing only the pending entries', async () => {
    renderAt('/admin-hours/manage?status=pending');

    expect(await screen.findByText('Jordan Avery')).toBeInTheDocument();
    expect(screen.queryByText('Sam Ortiz')).not.toBeInTheDocument();
    expect(mockListAll).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(screen.getByRole('button', { name: /Pending Review/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Categories' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens on Categories without the parameter, as before', async () => {
    renderAt('/admin-hours/manage');

    expect(await screen.findByText('categories-tab')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Categories' })).toHaveAttribute('aria-pressed', 'true');
    expect(mockListAll).not.toHaveBeenCalled();
  });

  it('drops the filter from the URL when another tab is chosen', async () => {
    const user = userEvent.setup();
    renderAt('/admin-hours/manage?status=pending');
    await screen.findByText('Jordan Avery');

    await user.click(screen.getByRole('button', { name: 'Categories' }));

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.getByText('categories-tab')).toBeInTheDocument();
  });
});
