/**
 * Lead W69: a donation's PUT worked but nothing could load one gift to edit
 * it. The record form now edits at `/grants/donations/:donationId/edit`, and
 * an update sends every field it owns, with an emptied one as null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));

const { getDonation, updateDonation, createDonation, listDonors, listCampaigns, listDonations } = vi.hoisted(() => ({
  getDonation: vi.fn(),
  updateDonation: vi.fn(),
  createDonation: vi.fn(),
  listDonors: vi.fn(),
  listCampaigns: vi.fn(),
  listDonations: vi.fn(),
}));
vi.mock('../services/api', () => ({
  fundraisingService: {
    getDonation: (...a: unknown[]) => getDonation(...a) as unknown,
    updateDonation: (...a: unknown[]) => updateDonation(...a) as unknown,
    createDonation: (...a: unknown[]) => createDonation(...a) as unknown,
    listDonors: (...a: unknown[]) => listDonors(...a) as unknown,
    listCampaigns: (...a: unknown[]) => listCampaigns(...a) as unknown,
    listDonations: (...a: unknown[]) => listDonations(...a) as unknown,
  },
}));

import DonationFormPage from './DonationFormPage';
import DonationsPage from './DonationsPage';

const DONATION = {
  id: 'don-1',
  organizationId: 'o1',
  campaignId: 'camp-1',
  donorId: null,
  amount: '125.00',
  currency: 'USD',
  donationDate: '2026-10-04T00:00:00Z',
  paymentMethod: 'check',
  paymentStatus: 'completed',
  transactionId: null,
  checkNumber: null,
  isRecurring: false,
  recurringFrequency: null,
  isAnonymous: false,
  donorName: 'Sam Lee',
  donorEmail: 'sam@example.org',
  dedicationType: 'in_memory',
  dedicationName: 'Chief Ward',
  notes: 'Left at the station',
  receiptSent: false,
  thankYouSent: false,
  taxDeductible: true,
  recordedBy: null,
  createdAt: '2026-10-04T00:00:00Z',
  updatedAt: '2026-10-04T00:00:00Z',
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/grants/donations" element={<DonationsPage />} />
        <Route path="/grants/donations/:donationId/edit" element={<DonationFormPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('Editing a donation (W69)', () => {
  beforeEach(() => {
    for (const fn of [getDonation, updateDonation, createDonation, listDonors, listCampaigns, listDonations]) {
      fn.mockReset();
    }
    getDonation.mockResolvedValue(structuredClone(DONATION));
    updateDonation.mockResolvedValue(DONATION);
    listDonors.mockResolvedValue([]);
    listCampaigns.mockResolvedValue([{ id: 'camp-1', name: 'New Engine Fund' }]);
    listDonations.mockResolvedValue([structuredClone(DONATION)]);
  });

  it('loads the gift and saves every field, clearing the emptied ones', async () => {
    const user = userEvent.setup();
    renderAt('/grants/donations/don-1/edit');

    expect(await screen.findByRole('heading', { name: 'Edit Donation' })).toBeInTheDocument();
    expect(getDonation).toHaveBeenCalledWith('don-1');
    const amount = screen.getByLabelText('Amount');
    expect(amount).toHaveValue(125);

    await user.clear(amount);
    await user.type(amount, '150');
    await user.selectOptions(screen.getByLabelText(/^Dedication/), '');
    await user.clear(screen.getByLabelText(/^Notes/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateDonation).toHaveBeenCalledTimes(1));
    expect(updateDonation).toHaveBeenCalledWith('don-1', {
      amount: 150,
      donationDate: '2026-10-04T00:00:00.000Z',
      paymentMethod: 'check',
      paymentStatus: 'completed',
      donorId: null,
      campaignId: 'camp-1',
      donorName: 'Sam Lee',
      donorEmail: 'sam@example.org',
      isAnonymous: false,
      dedicationType: null,
      dedicationName: null,
      taxDeductible: true,
      notes: null,
    });
    expect(createDonation).not.toHaveBeenCalled();
  });

  it('shows a message rather than a blank form when the gift cannot be loaded', async () => {
    getDonation.mockReset();
    getDonation.mockRejectedValue(new Error('404'));
    renderAt('/grants/donations/don-1/edit');

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('links each row of the list to its edit page', async () => {
    renderAt('/grants/donations');

    const table = await screen.findByRole('table');
    const link = await within(table).findByRole('link', { name: /Edit the .* donation from Sam Lee/ });
    expect(link).toHaveAttribute('href', '/grants/donations/don-1/edit');
  });
});
