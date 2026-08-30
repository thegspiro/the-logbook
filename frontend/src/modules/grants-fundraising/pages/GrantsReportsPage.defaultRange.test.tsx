/**
 * Regression test for the reports page's default date range around a
 * year boundary.
 *
 * `getDefaultDateRange` used to build the start-of-year bound from the
 * *runtime's* local year (`new Date().getFullYear()`) and then convert
 * that `Date` instant into the organization's timezone — instead of
 * deriving the year from the organization's own local "today" directly.
 * Near midnight UTC on January 1st, an organization in a timezone behind
 * UTC (e.g. `America/Los_Angeles`) is still in the previous year while
 * the test runtime's own year has already rolled over, so the old code
 * produced a start date *after* the correct start of the organization's
 * actual current year — collapsing the default range to a single day
 * instead of the full year.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { GrantReport, FundraisingReport } from '../types';

const mockGetGrantReport = vi.fn();
const mockGetFundraisingReport = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    getGrantReport: (...a: unknown[]) => mockGetGrantReport(...a) as unknown,
    getFundraisingReport: (...a: unknown[]) => mockGetFundraisingReport(...a) as unknown,
  },
}));

// This organization is 8 hours behind UTC — the mismatch that exposes the
// bug when the system clock has already crossed into the new year in UTC.
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'America/Los_Angeles' }));

import GrantsReportsPage from './GrantsReportsPage';

const EMPTY_GRANT_REPORT: GrantReport = {
  totalApplications: 0,
  totalRequested: 0,
  totalAwarded: 0,
  totalSpent: 0,
  successRate: 0,
  awardedCount: 0,
  deniedCount: 0,
  complianceSummary: { totalTasks: 0, completed: 0, overdue: 0, pending: 0 },
  spendingByCategory: {},
};

const EMPTY_FUNDRAISING_REPORT: FundraisingReport = {
  totalDonations: 0,
  donationCount: 0,
  uniqueDonors: 0,
  averageGift: 0,
  donationsByMethod: {},
  monthlyTotals: [],
};

describe('GrantsReportsPage — default date range at a year boundary', () => {
  beforeEach(() => {
    mockGetGrantReport.mockReset();
    mockGetFundraisingReport.mockReset();
    mockGetGrantReport.mockResolvedValue(EMPTY_GRANT_REPORT);
    mockGetFundraisingReport.mockResolvedValue(EMPTY_FUNDRAISING_REPORT);
    // 00:30 UTC on New Year's Day — already 2027 in UTC, but still
    // 2026-12-31 16:30 in America/Los_Angeles. Fakes only `Date`, not
    // timers — faking `setTimeout` too starves Testing Library's own
    // `waitFor` polling loop and the component's data-fetch effect.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-01T00:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the organization's full current year, not a single day", async () => {
    render(
      <MemoryRouter>
        <GrantsReportsPage />
      </MemoryRouter>
    );

    const startInput = await screen.findByLabelText<HTMLInputElement>('Start date');
    const endInput = screen.getByLabelText<HTMLInputElement>('End date');

    // The organization's own "today" is still 2026-12-31, so its current
    // year starts 2026-01-01. Before the fix, `start` came out as
    // 2026-12-31 too (the same as `end`).
    await waitFor(() => {
      expect(startInput.value).toBe('2026-01-01');
      expect(endInput.value).toBe('2026-12-31');
    });
  });
});
