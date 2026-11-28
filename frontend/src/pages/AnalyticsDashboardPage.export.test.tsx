/**
 * A failed export says so and saves nothing; a good one is named by the
 * department's date.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/analytics', () => ({
  analyticsService: {
    getOverallMetrics: vi.fn(),
    getEventMetrics: vi.fn(),
    exportAnalytics: vi.fn(),
  },
}));
const saveBlob = vi.fn();
vi.mock('../utils/saveBlob', () => ({ saveBlob: (...a: unknown[]) => saveBlob(...a) as unknown }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({ default: { error: (...a: unknown[]) => toastError(...a) as unknown } }));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import AnalyticsDashboardPage from './AnalyticsDashboardPage';
import { analyticsService } from '../services/analytics';

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

const renderPage = () =>
  render(
    <MemoryRouter>
      <AnalyticsDashboardPage />
    </MemoryRouter>
  );

describe('AnalyticsDashboardPage export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analyticsService.getOverallMetrics).mockResolvedValue(metrics);
  });

  it('says a failed export failed and saves nothing', async () => {
    vi.mocked(analyticsService.exportAnalytics).mockRejectedValue(new Error('Not allowed'));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Export Data/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Not allowed'));
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("names a good export by the department's date", async () => {
    vi.mocked(analyticsService.exportAnalytics).mockResolvedValue('{"events":[1]}');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Export Data/ }));

    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    const name = saveBlob.mock.calls[0]?.[1] as string;
    expect(name).toMatch(/^analytics-overall-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
