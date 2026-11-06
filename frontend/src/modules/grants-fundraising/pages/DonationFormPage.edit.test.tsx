/**
 * Lead W69: a donation's PUT worked but nothing could load one gift to edit
 * it. The record form now edits at `/grants/donations/:donationId/edit`, and
 * an update sends every field it owns, with an emptied one as null.
 *
 * A gift that pays toward a pledge (owner decision 2026-11-01) keeps that
 * pledge in the picker while it is edited, even once the pledge is fulfilled,
 * and unlinking it or changing the donor sends `pledgeId: null`.
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

const { getDonation, updateDonation, createDonation, listDonors, listCampaigns, listDonations, listPledges } =
  vi.hoisted(() => ({
    getDonation: vi.fn(),
    updateDonation: vi.fn(),
    createDonation: vi.fn(),
    listDonors: vi.fn(),
    listCampaigns: vi.fn(),
    listDonations: vi.fn(),
    listPledges: vi.fn(),
  }));
vi.mock('../services/api', () => ({
  fundraisingService: {
    getDonation: (...a: unknown[]) => getDonation(...a) as unknown,
    updateDonation: (...a: unknown[]) => updateDonation(...a) as unknown,
    createDonation: (...a: unknown[]) => createDonation(...a) as unknown,
    listDonors: (...a: unknown[]) => listDonors(...a) as unknown,
    listCampaigns: (...a: unknown[]) => listCampaigns(...a) as unknown,
    listDonations: (...a: unknown[]) => listDonations(...a) as unknown,
    listPledges: (...a: unknown[]) => listPledges(...a) as unknown,
  },
}));

import DonationFormPage from './DonationFormPage';
import DonationsPage from './DonationsPage';

const DONATION = {
  id: 'don-1',
  organizationId: 'o1',
  campaignId: 'camp-1',
  donorId: null,
  pledgeId: null,
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
    for (const fn of [
      getDonation,
      updateDonation,
      createDonation,
      listDonors,
      listCampaigns,
      listDonations,
      listPledges,
    ]) {
      fn.mockReset();
    }
    getDonation.mockResolvedValue(structuredClone(DONATION));
    updateDonation.mockResolvedValue(DONATION);
    listDonors.mockResolvedValue([]);
    listCampaigns.mockResolvedValue([{ id: 'camp-1', name: 'New Engine Fund' }]);
    listDonations.mockResolvedValue([structuredClone(DONATION)]);
    listPledges.mockResolvedValue([]);
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
      pledgeId: null,
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

  describe('a gift paying toward a pledge', () => {
    const pledge = (id: string, status: string, donorId = 'donor-1') => ({
      id,
      organizationId: 'o1',
      campaignId: null,
      donorId,
      pledgedAmount: '125.00',
      fulfilledAmount: status === 'fulfilled' ? '125.00' : '0.00',
      pledgeDate: '2026-09-01',
      dueDate: null,
      status,
      paymentSchedule: null,
      reminderEnabled: false,
      notes: null,
      createdBy: null,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    });

    beforeEach(() => {
      getDonation.mockResolvedValue({ ...structuredClone(DONATION), donorId: 'donor-1', pledgeId: 'p-paid' });
      listDonors.mockResolvedValue([
        { id: 'donor-1', firstName: 'Sam', lastName: 'Lee', donorType: 'individual' },
        { id: 'donor-2', firstName: 'Ana', lastName: 'Ruiz', donorType: 'individual' },
      ]);
      // The gift itself fulfilled p-paid; p-open is another open pledge.
      listPledges.mockResolvedValue([pledge('p-paid', 'fulfilled'), pledge('p-open', 'pending')]);
    });

    const payload = () => updateDonation.mock.calls[0]?.[1] as Record<string, unknown>;

    it('keeps the fulfilled pledge it pays toward selected and sends it back', async () => {
      const user = userEvent.setup();
      renderAt('/grants/donations/don-1/edit');

      const picker = await screen.findByLabelText(/pays toward a pledge/i);
      await waitFor(() => expect(picker).toHaveValue('p-paid'));
      expect(
        within(picker)
          .getAllByRole('option')
          .map((o) => o.getAttribute('value'))
      ).toEqual(['', 'p-paid', 'p-open']);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(updateDonation).toHaveBeenCalledTimes(1));
      expect(payload().pledgeId).toBe('p-paid');
    });

    it('sends null when the pledge is taken off the gift', async () => {
      const user = userEvent.setup();
      renderAt('/grants/donations/don-1/edit');

      const picker = await screen.findByLabelText(/pays toward a pledge/i);
      await waitFor(() => expect(picker).toHaveValue('p-paid'));
      await user.selectOptions(picker, '');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(updateDonation).toHaveBeenCalledTimes(1));
      expect(payload().pledgeId).toBeNull();
    });

    it('drops the pledge when the gift moves to another donor', async () => {
      const user = userEvent.setup();
      listPledges.mockImplementation((params: { donorId: string }) =>
        Promise.resolve(params.donorId === 'donor-1' ? [pledge('p-paid', 'fulfilled')] : [])
      );
      renderAt('/grants/donations/don-1/edit');

      await waitFor(() => expect(screen.getByLabelText(/pays toward a pledge/i)).toHaveValue('p-paid'));
      await user.selectOptions(screen.getByRole('combobox', { name: /^Donor/ }), 'donor-2');
      await waitFor(() => expect(screen.queryByLabelText(/pays toward a pledge/i)).not.toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(updateDonation).toHaveBeenCalledTimes(1));
      expect(payload().donorId).toBe('donor-2');
      expect(payload().pledgeId).toBeNull();
    });
  });
});
