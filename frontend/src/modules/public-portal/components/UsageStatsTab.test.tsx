/**
 * Usage Statistics — the numbers, and the alert that could not fire.
 *
 * This tab read twenty-two field names; the endpoint sent nine. The thirteen
 * it did not send rendered as `0`, as `undefined`, and — for the response-time
 * tile, which interpolated into a template literal — as the literal string
 * `undefinedms`.
 *
 * The part that mattered was the "Attention Required" banner. Its three
 * conditions read `error_rate_percentage`, `flagged_suspicious_24h` and
 * `rate_limit_hits_24h`, each coalesced with `?? 0`, so every one of them
 * compared `0 > threshold` whatever the traffic did. The banner was
 * unreachable, and nothing about the screen said so: a dashboard that cannot
 * report a problem looks exactly like a dashboard with no problems to report.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PublicPortalUsageStats } from '../types';

const mockGetUsageStats = vi.fn();

vi.mock('../services/publicPortalApi', () => ({
  getUsageStats: (...a: unknown[]) => mockGetUsageStats(...a) as unknown,
}));

vi.mock('react-hot-toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Import the component AFTER the mocks are in place.
import { UsageStatsTab } from './UsageStatsTab';

const QUIET: PublicPortalUsageStats = {
  total_requests: 1200,
  total_requests_24h: 48,
  total_requests_7d: 340,
  total_requests_30d: 1200,
  requests_today: 40,
  requests_this_week: 300,
  requests_this_month: 1100,
  unique_ips: 90,
  unique_ips_24h: 12,
  active_api_keys: 3,
  rate_limit_hits_24h: 0,
  flagged_suspicious_24h: 0,
  status_2xx_24h: 47,
  status_4xx_24h: 1,
  status_5xx_24h: 0,
  average_response_time_ms: 87.4,
  error_rate_percentage: 2.08,
  top_endpoints: [
    { endpoint: '/organization/info', count: 200 },
    { endpoint: '/events/public', count: 140 },
  ],
  requests_by_status: { 200: 1150, 404: 50 },
  flagged_requests: 4,
};

const renderTab = async () => {
  render(<UsageStatsTab />);
  await screen.findByText('Usage Statistics');
};

const tile = (title: string): HTMLElement => {
  const card = screen.getByText(title).closest('div.card');
  if (!card) throw new Error(`no tile found for ${title}`);
  return card as HTMLElement;
};

describe('UsageStatsTab', () => {
  // States its own default rather than inheriting one (CLAUDE.md #28).
  beforeEach(() => {
    mockGetUsageStats.mockReset();
    mockGetUsageStats.mockResolvedValue(QUIET);
  });

  describe('the tiles report what the backend measured', () => {
    it('shows each rolling window and its average', async () => {
      await renderTab();

      expect(within(tile('Last 24 Hours')).getByText('48')).toBeInTheDocument();
      expect(within(tile('Last 24 Hours')).getByText('Avg: 2/hour')).toBeInTheDocument();
      expect(within(tile('Last 7 Days')).getByText('340')).toBeInTheDocument();
      expect(within(tile('Last 30 Days')).getByText('1,200')).toBeInTheDocument();
    });

    it('shows the key metrics that used to render undefined', async () => {
      await renderTab();

      expect(within(tile('Active API Keys')).getByText('3')).toBeInTheDocument();
      expect(within(tile('Unique IPs (24h)')).getByText('12')).toBeInTheDocument();
      expect(within(tile('2xx Success')).getByText('47')).toBeInTheDocument();
    });

    it('renders a response time rather than the string "undefinedms"', async () => {
      await renderTab();

      expect(within(tile('Avg Response Time')).getByText('87ms')).toBeInTheDocument();
      expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    });

    it('ranks endpoints by share of the week, not of the ten shown', async () => {
      await renderTab();

      // 200 of 340 requests in the last 7 days.
      expect(screen.getByText('200 (58.8%)')).toBeInTheDocument();
      expect(screen.getByText('140 (41.2%)')).toBeInTheDocument();
    });
  });

  describe('the Attention Required banner', () => {
    it('stays quiet on a healthy portal', async () => {
      await renderTab();

      expect(screen.queryByText('Attention Required')).not.toBeInTheDocument();
    });

    it('fires on a high error rate', async () => {
      mockGetUsageStats.mockResolvedValue({ ...QUIET, error_rate_percentage: 12.5 });

      await renderTab();

      expect(screen.getByText('Attention Required')).toBeInTheDocument();
      expect(screen.getByText(/High error rate detected \(12\.50%\)/)).toBeInTheDocument();
    });

    it('fires on elevated suspicious activity', async () => {
      mockGetUsageStats.mockResolvedValue({ ...QUIET, flagged_suspicious_24h: 40 });

      await renderTab();

      expect(screen.getByText(/Elevated suspicious activity \(40 incidents in 24h\)/)).toBeInTheDocument();
    });

    it('fires on frequent rate limiting', async () => {
      mockGetUsageStats.mockResolvedValue({ ...QUIET, rate_limit_hits_24h: 120 });

      await renderTab();

      expect(screen.getByText(/Frequent rate limiting \(120 hits in 24h\)/)).toBeInTheDocument();
    });
  });

  describe('no traffic', () => {
    it('reports the error rate as unmeasurable rather than a healthy zero', async () => {
      // null is the backend saying the denominator was empty. 0.00% in green
      // would claim a clean bill of health for a portal nobody called.
      mockGetUsageStats.mockResolvedValue({
        ...QUIET,
        total_requests_24h: 0,
        status_2xx_24h: 0,
        status_4xx_24h: 0,
        status_5xx_24h: 0,
        error_rate_percentage: null,
      });

      await renderTab();

      const card = tile('Error Rate');
      expect(within(card).getByText('—')).toBeInTheDocument();
      expect(within(card).getByText('No requests in 24h')).toBeInTheDocument();
      expect(screen.queryByText('Attention Required')).not.toBeInTheDocument();
    });
  });
});
