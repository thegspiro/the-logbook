/**
 * The donations total is money received: only completed gifts count, as on
 * the server's campaign, donor and report totals. A refunded or pending gift
 * used to be added in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Donation } from '../types';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));

const listDonations = vi.fn();
vi.mock('../services/api', () => ({
  fundraisingService: {
    listDonations: (...args: unknown[]) => listDonations(...args) as unknown,
    listDonors: () => Promise.resolve([]),
  },
}));

import DonationsPage from './DonationsPage';

const gift = (id: string, amount: number, paymentStatus: string): Donation => ({
  id,
  organizationId: 'org-1',
  campaignId: null,
  donorId: null,
  pledgeId: null,
  amount,
  currency: 'USD',
  donationDate: '2026-11-06T12:00:00Z',
  paymentMethod: 'check',
  paymentStatus,
  transactionId: null,
  checkNumber: null,
  isRecurring: false,
  recurringFrequency: null,
  isAnonymous: false,
  donorName: `Donor ${id}`,
  donorEmail: null,
  dedicationType: null,
  dedicationName: null,
  notes: null,
  receiptSent: false,
  thankYouSent: false,
  taxDeductible: true,
  recordedBy: null,
  createdAt: '2026-11-06T12:00:00Z',
  updatedAt: '2026-11-06T12:00:00Z',
});

describe('DonationsPage total', () => {
  beforeEach(() => {
    listDonations.mockReset();
  });

  it('counts completed gifts only', async () => {
    listDonations.mockResolvedValue([
      gift('a', 200, 'completed'),
      gift('b', 500, 'refunded'),
      gift('c', 75, 'pending'),
    ]);
    render(
      <MemoryRouter>
        <DonationsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Total received (1 completed gift)')).toBeInTheDocument();
    // $200.00 twice: the gift's own row and the total. $775.00 (every gift) nowhere.
    expect(screen.getAllByText('$200.00')).toHaveLength(2);
    expect(screen.queryByText('$775.00')).not.toBeInTheDocument();
  });
});
