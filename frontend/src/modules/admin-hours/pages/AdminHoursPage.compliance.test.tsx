/**
 * The requirement rows take the server's word on whether a requirement is met
 * (loggedHours arrives rounded to the quarter, the status is graded on the
 * raw minutes), and name the period's last day, not the exclusive bound the
 * server sends as its end.
 */

import { screen } from '@testing-library/react';
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
let activeSessionLoading = false;

const storeState = () => ({
  categories: [
    { id: 'category-1', name: 'Administration', maxHoursPerSession: null },
    { id: 'category-2', name: 'Community outreach', maxHoursPerSession: null },
  ],
  myEntries: [],
  myEntriesTotal: 0,
  entriesLoading: false,
  activeSession: null,
  activeSessionLoading,
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

describe('AdminHoursPage requirement rows', () => {
  beforeEach(() => {
    mySummary = populatedSummary;
    activeSessionLoading = false;
    vi.clearAllMocks();
  });

  it('does not call a requirement met when the server says it is not', async () => {
    // 7h53m of 8: the server rounds the figure to 8 and grades the raw minutes.
    getUserCompliance.mockResolvedValue([
      {
        categoryId: 'category-1',
        categoryName: 'Administration',
        categoryColor: '#2563eb',
        requiredHours: 8,
        loggedHours: 8,
        frequency: 'annual',
        status: 'at_risk',
        periodStart: '2026-01-01T05:00:00+00:00',
        periodEnd: '2027-01-01T05:00:00+00:00',
      },
    ]);

    renderWithRouter(<AdminHoursPage />);

    expect(await screen.findByText(/still needed/)).toBeInTheDocument();
    expect(screen.queryByText(/Requirement met/)).not.toBeInTheDocument();
  });

  it("names the period's last day, not the midnight that opens the next", async () => {
    getUserCompliance.mockResolvedValue([
      {
        categoryId: 'category-1',
        categoryName: 'Administration',
        categoryColor: '#2563eb',
        requiredHours: 8,
        loggedHours: 9,
        frequency: 'annual',
        status: 'compliant',
        periodStart: '2026-01-01T05:00:00+00:00',
        periodEnd: '2027-01-01T05:00:00+00:00',
      },
    ]);

    renderWithRouter(<AdminHoursPage />);

    const line = await screen.findByText(/Requirement met/);
    expect(line).toHaveTextContent(/period ends .*2026/);
    expect(line).not.toHaveTextContent(/2027/);
  });
});
