import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
