/**
 * Regression test for the payment-method percentage math on the Fundraising
 * Reports tab.
 *
 * `FundraisingReportResponse.donations_by_method` holds backend `Decimal`
 * values, which Pydantic serializes as JSON *strings* — the frontend type
 * declares `Record<string, number>` regardless (see currencyFormatting.ts's
 * `Money` doc comment: this mismatch between declared type and wire shape is
 * deliberate and app-wide). Summing those values with `sum + v` therefore
 * hits `+`'s string-concatenation behavior rather than numeric addition —
 * `0 + "10.10" + "20.20"` becomes the string `"010.1020.20"`, not `30.30` —
 * which corrupted every displayed percentage whenever 2+ payment methods had
 * donations. This test simulates the real (string) wire shape rather than a
 * clean `number`, which is exactly what let the bug through untested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { FundraisingReport, GrantReport } from '../types';

const mockGetGrantReport = vi.fn();
const mockGetFundraisingReport = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    getGrantReport: (...a: unknown[]) => mockGetGrantReport(...a) as unknown,
    getFundraisingReport: (...a: unknown[]) => mockGetFundraisingReport(...a) as unknown,
  },
}));

vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

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

describe('GrantsReportsPage — donations-by-method percentages', () => {
  beforeEach(() => {
    mockGetGrantReport.mockReset();
    mockGetFundraisingReport.mockReset();
    mockGetGrantReport.mockResolvedValue(EMPTY_GRANT_REPORT);
  });

  it('computes correct percentages when the backend sends Decimal amounts as strings', async () => {
    const fundraisingReport = {
      totalDonations: '30.30',
      donationCount: 2,
      uniqueDonors: 2,
      averageGift: '15.15',
      // Real wire shape: JSON strings, not numbers, despite the declared type.
      donationsByMethod: { cash: '10.10', check: '20.20' },
      monthlyTotals: [],
    } as unknown as FundraisingReport;
    mockGetFundraisingReport.mockResolvedValue(fundraisingReport);

    render(
      <MemoryRouter>
        <GrantsReportsPage />
      </MemoryRouter>
    );

    await userEvent.click(await screen.findByRole('button', { name: /fundraising reports/i }));

    // 10.10 / 30.30 = 33.3%; 20.20 / 30.30 = 66.7%. Before the fix, the
    // string-concatenated total made both percentages come out as 0.0%.
    await waitFor(() => {
      expect(screen.getByText('33.3%')).toBeInTheDocument();
      expect(screen.getByText('66.7%')).toBeInTheDocument();
    });
  });
});
