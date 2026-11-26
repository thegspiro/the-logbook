import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnalyticsDashboardPage from './AnalyticsDashboardPage';
import { analyticsService } from '../services/analytics';
import { eventService } from '../services/api';
import type { Event } from '../types/event';

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

  describe('scoped to one event', () => {
    const renderForEvent = () =>
      render(
        <MemoryRouter initialEntries={['/events/evt-1/analytics']}>
          <Routes>
            <Route path="/events/:id/analytics" element={<AnalyticsDashboardPage />} />
          </Routes>
        </MemoryRouter>
      );

    beforeEach(() => {
      vi.mocked(analyticsService.getEventMetrics).mockReset();
      vi.spyOn(eventService, 'getEvent').mockResolvedValue({ id: 'evt-1', title: 'Monthly Drill' } as Event);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('names the event in the trail rather than a placeholder', async () => {
      vi.mocked(analyticsService.getEventMetrics).mockResolvedValue(metrics);
      renderForEvent();

      const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
      expect(await within(trail).findByRole('link', { name: 'Monthly Drill' })).toHaveAttribute(
        'href',
        '/events/evt-1'
      );
      expect(eventService.getEvent).toHaveBeenCalledWith('evt-1');
    });

    it('keeps the Events strip and trail when the figures cannot be loaded', async () => {
      vi.mocked(analyticsService.getEventMetrics).mockRejectedValue(new Error('offline'));
      renderForEvent();

      expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Events sections' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'QR Code Analytics' })).toBeInTheDocument();
      // Nothing to export without figures.
      expect(screen.queryByRole('button', { name: 'Export Data' })).not.toBeInTheDocument();
    });
  });
});
