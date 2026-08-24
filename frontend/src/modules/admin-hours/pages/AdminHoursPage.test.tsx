/**
 * The personal admin-hours view answers three questions for one member: how do
 * I stand against my requirements, what have I logged in a period I chose, and
 * what is still waiting on an approver. These cover the parts that were wrong
 * or missing before: the summary was fetched unscoped (returning the whole
 * department's hours to anyone holding admin_hours.manage), there was no way to
 * pick a period, and requirements were never shown at all.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { AdminHoursComplianceItem, AdminHoursSummary } from '../types';
import AdminHoursPage from './AdminHoursPage';

interface SummaryParams {
  userId: string;
  startDate?: string;
  endDate?: string;
}

interface EntryParams {
  startDate?: string;
  endDate?: string;
}

const fetchMySummary = vi.fn<(params: SummaryParams) => Promise<void>>();
const fetchMyEntries = vi.fn<(params?: EntryParams) => Promise<void>>();
const fetchCategories = vi.fn();
const fetchActiveSession = vi.fn();
const getUserCompliance = vi.fn<() => Promise<AdminHoursComplianceItem[]>>();

let mySummary: AdminHoursSummary | null;

const storeState = () => ({
  categories: [
    { id: 'category-1', name: 'Administration', maxHoursPerSession: null },
    { id: 'category-2', name: 'Community outreach', maxHoursPerSession: null },
  ],
  myEntries: [],
  myEntriesTotal: 0,
  entriesLoading: false,
  activeSession: null,
  activeSessionLoading: false,
  mySummary,
  mySummaryLoading: false,
  error: null,
  fetchCategories,
  fetchMyEntries,
  fetchActiveSession,
  clockOut: vi.fn(),
  fetchMySummary,
  clearError: vi.fn(),
});

vi.mock('../store/adminHoursStore', () => ({
  useAdminHoursStore: () => storeState(),
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'member-1' } }),
}));

// Pin the department timezone so the derived UTC period bounds are stable
// regardless of the machine running the suite.
vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../services/api', () => ({
  adminHoursEntryService: { createManual: vi.fn() },
  adminHoursComplianceService: { getUserCompliance: () => getUserCompliance() },
}));

const populatedSummary: AdminHoursSummary = {
  totalHours: 10,
  totalEntries: 4,
  approvedHours: 7,
  approvedEntries: 3,
  pendingHours: 3,
  pendingEntries: 1,
  periodStart: null,
  periodEnd: null,
  byCategory: [
    {
      categoryId: 'category-1',
      categoryName: 'Administration',
      categoryColor: '#2563eb',
      totalMinutes: 600,
      totalHours: 10,
      entryCount: 4,
    },
  ],
};

describe('AdminHoursPage', () => {
  beforeEach(() => {
    mySummary = populatedSummary;
    vi.clearAllMocks();
    getUserCompliance.mockResolvedValue([]);
  });

  it('scopes the summary to the signed-in member', async () => {
    renderWithRouter(<AdminHoursPage />);

    await waitFor(() => expect(fetchMySummary).toHaveBeenCalled());
    const params = fetchMySummary.mock.calls[0]?.[0];
    expect(params?.userId).toBe('member-1');
  });

  it('opens on all time, with no period bounds on either request', async () => {
    renderWithRouter(<AdminHoursPage />);

    await waitFor(() => expect(fetchMySummary).toHaveBeenCalled());
    for (const [params] of fetchMySummary.mock.calls) {
      expect(params.startDate).toBeUndefined();
      expect(params.endDate).toBeUndefined();
    }
    expect(fetchMyEntries.mock.calls[0]?.[0]?.startDate).toBeUndefined();
    expect(fetchMyEntries.mock.calls[0]?.[0]?.endDate).toBeUndefined();
  });

  it('requests the same period for the totals and the entry list', async () => {
    renderWithRouter(<AdminHoursPage />);
    await waitFor(() => expect(fetchMySummary).toHaveBeenCalled());
    fetchMySummary.mockClear();
    fetchMyEntries.mockClear();

    fireEvent.change(screen.getByLabelText(/showing/i), { target: { value: 'year' } });

    await waitFor(() => expect(fetchMySummary).toHaveBeenCalled());
    const summaryParams = fetchMySummary.mock.calls[0]?.[0];
    const entryParams = fetchMyEntries.mock.calls[0]?.[0];
    expect(summaryParams?.startDate).toBe(entryParams?.startDate);
    expect(summaryParams?.endDate).toBe(entryParams?.endDate);
    // A named window bounds on a real UTC instant derived from a
    // department-local midnight, not a bare calendar date.
    expect(summaryParams?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('shows approved and pending hours separately', async () => {
    renderWithRouter(<AdminHoursPage />);

    expect(await screen.findByText('Awaiting review')).toBeInTheDocument();
    expect(screen.getByText('3 entries credited')).toBeInTheDocument();
    expect(screen.getByText('1 entry with an approver')).toBeInTheDocument();
    expect(screen.getByText('4 entries, approved and pending')).toBeInTheDocument();
  });

  it('names the categories with no hours instead of tiling a zero for each', async () => {
    renderWithRouter(<AdminHoursPage />);

    expect(await screen.findByText(/No hours yet for: Community outreach/)).toBeInTheDocument();
  });

  it('renders requirement progress when the department has set requirements', async () => {
    getUserCompliance.mockResolvedValue([
      {
        categoryId: 'category-1',
        categoryName: 'Administration',
        categoryColor: '#2563eb',
        requiredHours: 24,
        loggedHours: 7,
        frequency: 'annual',
        status: 'at_risk',
        periodStart: '2026-01-01T00:00:00+00:00',
        periodEnd: '2026-12-31T00:00:00+00:00',
      },
    ]);

    renderWithRouter(<AdminHoursPage />);

    expect(await screen.findByText('My requirements')).toBeInTheDocument();
    expect(screen.getByText('7 / 24 hrs')).toBeInTheDocument();
    expect(screen.getByText(/17 hrs still needed/)).toBeInTheDocument();
    expect(screen.getByText('At risk')).toBeInTheDocument();
  });

  it('omits the requirements section when the department has set none', async () => {
    renderWithRouter(<AdminHoursPage />);

    await waitFor(() => expect(fetchMySummary).toHaveBeenCalled());
    expect(screen.queryByText('My requirements')).not.toBeInTheDocument();
  });

  it('tells a member with no hours what to do instead of showing an empty breakdown', async () => {
    mySummary = { ...populatedSummary, totalEntries: 0, totalHours: 0, byCategory: [] };

    renderWithRouter(<AdminHoursPage />);

    expect(await screen.findByText(/No hours logged yet/)).toBeInTheDocument();
    expect(screen.queryByText('Where my hours went')).not.toBeInTheDocument();
  });
});
