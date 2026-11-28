/**
 * The clocked-in card's elapsed time follows the wall clock. A phone
 * suspends timers while locked, so counting ticks showed minutes after hours
 * away, and the session-limit warning, driven by the same figure, fired late.
 */

import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { AdminHoursActiveSession, AdminHoursComplianceItem, AdminHoursSummary } from '../types';
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
let activeSession: AdminHoursActiveSession | null = null;

const storeState = () => ({
  categories: [
    { id: 'category-1', name: 'Administration', maxHoursPerSession: null },
    { id: 'category-2', name: 'Community outreach', maxHoursPerSession: null },
  ],
  myEntries: [],
  myEntriesTotal: 0,
  entriesLoading: false,
  activeSession,
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

describe('AdminHoursPage elapsed time', () => {
  beforeEach(() => {
    mySummary = populatedSummary;
    activeSessionLoading = false;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getUserCompliance.mockResolvedValue([]);
    activeSession = {
      id: 'entry-1',
      categoryId: 'category-1',
      categoryName: 'Administration',
      categoryColor: null,
      clockInAt: '2026-11-26T12:00:00Z',
      elapsedMinutes: 10,
      maxSessionMinutes: null,
    };
  });

  it('catches up when the page is shown again after the phone slept', async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    renderWithRouter(<AdminHoursPage />);
    expect(await screen.findByText('10m')).toBeInTheDocument();

    // Two hours locked: no interval ran.
    now.mockReturnValue(start + 120 * 60000);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByText('2h 10m')).toBeInTheDocument();
  });
});
