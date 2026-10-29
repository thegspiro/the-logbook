import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnalyticsDashboardPage from './AnalyticsDashboardPage';
import { analyticsService } from '../services/analytics';

vi.mock('../services/analytics', () => ({
  analyticsService: {
    getOverallMetrics: vi.fn(),
    getEventMetrics: vi.fn(),
    exportAnalytics: vi.fn(),
  },
}));

const metrics = {
  totalScans: 1,
  successfulCheckIns: 1,
  failedCheckIns: 0,
  successRate: 100,
  avgTimeToCheckIn: 5,
  deviceBreakdown: { mobile: 1, desktop: 0, tablet: 0, unknown: 0 },
  errorBreakdown: {},
  hourlyActivity: [],
  checkInTrends: [],
};

describe('AnalyticsDashboardPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retries the failed request when Retry is clicked', async () => {
    vi.mocked(analyticsService.getOverallMetrics)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(metrics);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AnalyticsDashboardPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(analyticsService.getOverallMetrics).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Total Scans')).toBeInTheDocument();
  });

  describe('while loading', () => {
    beforeEach(() => {
      vi.mocked(analyticsService.getOverallMetrics).mockReset();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('draws the header and the metric cards before the figures arrive', () => {
      vi.mocked(analyticsService.getOverallMetrics).mockReturnValue(new Promise(() => {}));
      render(
        <MemoryRouter>
          <AnalyticsDashboardPage />
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { name: 'QR Code Analytics' })).toBeInTheDocument();
      expect(screen.getByText('Total Scans')).toBeInTheDocument();
      expect(screen.getByText('Avg Time to Check-In')).toBeInTheDocument();
    });

    // The refresh sets `loading` too, and used to swap the whole page for a
    // bare "Loading analytics..." every ten seconds.
    it('keeps the figures on screen through the ten-second refresh', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.mocked(analyticsService.getOverallMetrics)
        .mockResolvedValueOnce({ ...metrics, totalScans: 42 })
        .mockReturnValue(new Promise(() => {}));
      render(
        <MemoryRouter>
          <AnalyticsDashboardPage />
        </MemoryRouter>
      );
      expect(await screen.findByText('42')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(analyticsService.getOverallMetrics).toHaveBeenCalledTimes(2);
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });
});
