/**
 * A failed metrics or export request reaches the caller. Answering zeros, or
 * a stand-in export body, made a refused or failed request look like a
 * department with no scans and no errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMetrics = vi.fn();
const exportAnalytics = vi.fn();
vi.mock('./api', () => ({
  analyticsApiService: {
    getMetrics: (...a: unknown[]) => getMetrics(...a) as unknown,
    exportAnalytics: (...a: unknown[]) => exportAnalytics(...a) as unknown,
  },
}));

import { analyticsService } from './analytics';

describe('analyticsService failures', () => {
  beforeEach(() => {
    getMetrics.mockReset();
    exportAnalytics.mockReset();
  });

  it('rejects when the overall metrics cannot be loaded', async () => {
    getMetrics.mockRejectedValue(new Error('403'));
    await expect(analyticsService.getOverallMetrics()).rejects.toThrow('403');
  });

  it("rejects when an event's metrics cannot be loaded", async () => {
    getMetrics.mockRejectedValue(new Error('500'));
    await expect(analyticsService.getEventMetrics('ev-1')).rejects.toThrow('500');
  });

  it('rejects when the export fails', async () => {
    exportAnalytics.mockRejectedValue(new Error('500'));
    await expect(analyticsService.exportAnalytics()).rejects.toThrow('500');
  });
});
