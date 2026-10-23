/**
 * Workflow review W78: the platform analytics charts drew nothing.
 *
 * Each bar's height was a percentage of a column sized by its content, so
 * every bar resolved to 0px; the counts lived only in a `title` tooltip, and
 * the login chart's heading claimed daily logins although it counts each
 * member once, on the day of their latest sign-in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PlatformAnalytics } from '../types/platformAnalytics';

const getAnalytics = vi.fn<() => Promise<PlatformAnalytics>>();

vi.mock('../services/api', () => ({
  platformAnalyticsService: {
    getAnalytics: () => getAnalytics(),
    exportAnalytics: vi.fn(),
  },
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import PlatformAnalyticsPage from './PlatformAnalyticsPage';

/** Consecutive calendar days ending 22 October 2026, one per count. */
const days = (counts: number[]): PlatformAnalytics['errorTrend'] =>
  counts.map((count, i) => ({ date: `2026-10-${String(22 - (counts.length - 1 - i)).padStart(2, '0')}`, count }));

const ANALYTICS: PlatformAnalytics = {
  totalUsers: 20,
  activeUsers: 3,
  inactiveUsers: 17,
  newUsersLast30Days: 0,
  adoptionRate: 15,
  loginTrend: days([0, 1, 0, 2]),
  modules: [{ name: 'Elections', enabled: false, recordCount: 0, lastActivity: null }],
  totalEvents: 0,
  eventsLast30Days: 0,
  totalCheckIns: 0,
  trainingHoursLast30Days: 0,
  formsSubmittedLast30Days: 0,
  errorsLast7Days: 4,
  errorTrend: days([0, 0, 0, 0, 0, 0, 4]),
  topErrorTypes: {},
  totalDocuments: 0,
  documentsLast30Days: 0,
  generatedAt: '2026-10-23T01:04:00Z',
};

describe('PlatformAnalyticsPage charts (W78)', () => {
  beforeEach(() => {
    getAnalytics.mockReset();
    getAnalytics.mockResolvedValue(structuredClone(ANALYTICS));
  });

  it('names each chart by what it counts, with the busy days read out', async () => {
    render(<PlatformAnalyticsPage />);

    expect(await screen.findByText('Latest Sign-In by Day (30 Days)')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Members by day of their latest sign-in: Oct 20 1, Oct 22 2' })
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Errors per day: Oct 22 4' })).toBeInTheDocument();
  });

  it('prints the count over a bar instead of leaving it to a tooltip', async () => {
    // jsdom does no layout, so the 0px bars themselves were measured in the
    // browser (findings W78-3); this pins the printed count.
    render(<PlatformAnalyticsPage />);

    const chart = await screen.findByRole('img', { name: /^Errors per day/ });
    expect(chart).toHaveTextContent('4');
  });
});
