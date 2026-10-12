/**
 * Recording a donation. The Donations page's primary action was removed
 * because its form never existed; it is back for a fundraising manager and
 * opens a form that posts the gift with blank optional fields omitted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p) }),
}));

const createDonation = vi.fn();
const listDonations = vi.fn();
const listDonors = vi.fn();
const listCampaigns = vi.fn();
vi.mock('../services/api', () => ({
  fundraisingService: {
    createDonation: (...args: unknown[]) => createDonation(...args) as unknown,
    listDonations: (...args: unknown[]) => listDonations(...args) as unknown,
    listDonors: (...args: unknown[]) => listDonors(...args) as unknown,
    listCampaigns: (...args: unknown[]) => listCampaigns(...args) as unknown,
  },
}));

import DonationFormPage from './DonationFormPage';
import DonationsPage from './DonationsPage';

const donor = {
  id: 'donor-1',
  firstName: 'Ann',
  lastName: 'Lee',
  companyName: 'Lee Hardware',
};
const campaign = { id: 'camp-1', name: 'New Engine Fund' };

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/grants/donations" element={<DonationsPage />} />
        <Route path="/grants/donations/new" element={<DonationFormPage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of [createDonation, listDonations, listDonors, listCampaigns]) m.mockReset();
  createDonation.mockResolvedValue({ id: 'don-1' });
  listDonations.mockResolvedValue([]);
  listDonors.mockResolvedValue([donor]);
  listCampaigns.mockResolvedValue([campaign]);
  granted = new Set(['fundraising.view', 'fundraising.manage']);
});

describe('Record Donation button', () => {
  it('opens the form for a fundraising manager', async () => {
    const user = userEvent.setup();
    renderAt('/grants/donations');

    await user.click(await screen.findByRole('link', { name: /record donation/i }));

    expect(await screen.findByRole('heading', { name: 'Record Donation' })).toBeInTheDocument();
  });

  it('is not offered to a viewer', async () => {
    granted = new Set(['fundraising.view']);
    renderAt('/grants/donations');

    await waitFor(() => expect(listDonations).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /record donation/i })).not.toBeInTheDocument();
  });
});

describe('DonationFormPage', () => {
  it('records a gift linked to a donor and campaign, blanks omitted', async () => {
    const user = userEvent.setup();
    renderAt('/grants/donations/new');

    await screen.findByRole('option', { name: 'Ann Lee (Lee Hardware)' });
    await user.type(screen.getByLabelText('Amount'), '250');
    await user.clear(screen.getByLabelText('Date received'));
    await user.type(screen.getByLabelText('Date received'), '2026-10-01');
    await user.selectOptions(screen.getByLabelText('Payment method'), 'cash');
    await user.selectOptions(screen.getByLabelText(/^campaign/i), 'camp-1');
    await user.selectOptions(screen.getByLabelText(/^donor \(optional\)/i), 'donor-1');
    // A directory donor carries their own name and email.
    expect(screen.queryByLabelText(/donor name/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record donation' }));

    await waitFor(() =>
      expect(createDonation).toHaveBeenCalledWith({
        amount: '250.00',
        donationDate: '2026-10-01T00:00:00.000Z',
        paymentMethod: 'cash',
        paymentStatus: 'completed',
        donorId: 'donor-1',
        campaignId: 'camp-1',
        donorName: undefined,
        donorEmail: undefined,
        isAnonymous: false,
        dedicationType: undefined,
        dedicationName: undefined,
        taxDeductible: true,
        notes: undefined,
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Donation recorded');
    expect(await screen.findByRole('heading', { name: 'Donations' })).toBeInTheDocument();
  });

  it('records a one-time gift by name, with a dedication', async () => {
    const user = userEvent.setup();
    renderAt('/grants/donations/new');

    await user.type(screen.getByLabelText('Amount'), '40');
    await user.type(screen.getByLabelText(/donor name/i), 'Walk-in donor');
    await user.selectOptions(screen.getByLabelText(/dedication/i), 'in_memory');
    await user.type(screen.getByLabelText('Honoring'), 'Capt. R. Moss');
    await user.click(screen.getByRole('button', { name: 'Record donation' }));

    await waitFor(() => expect(createDonation).toHaveBeenCalledTimes(1));
    const payload = createDonation.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.donorId).toBeUndefined();
    expect(payload.donorName).toBe('Walk-in donor');
    expect(payload.dedicationType).toBe('in_memory');
    expect(payload.dedicationName).toBe('Capt. R. Moss');
  });

  it('preselects the donor and campaign named in the link', async () => {
    renderAt('/grants/donations/new?donorId=donor-1&campaignId=camp-1');

    await screen.findByRole('option', { name: 'New Engine Fund' });
    expect(screen.getByLabelText(/^donor \(optional\)/i)).toHaveValue('donor-1');
    expect(screen.getByLabelText(/^campaign/i)).toHaveValue('camp-1');
  });

  it('requires an amount, and a name for a dedication', async () => {
    const user = userEvent.setup();
    renderAt('/grants/donations/new');

    await user.selectOptions(screen.getByLabelText(/dedication/i), 'in_honor');
    await user.click(screen.getByRole('button', { name: 'Record donation' }));

    expect(screen.getByText('Enter an amount greater than zero.')).toBeInTheDocument();
    expect(screen.getByText('Name the person the gift honours.')).toBeInTheDocument();
    expect(createDonation).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal and stays on the form", async () => {
    createDonation.mockRejectedValue(new Error('Campaign not found'));
    const user = userEvent.setup();
    renderAt('/grants/donations/new');

    await user.type(screen.getByLabelText('Amount'), '10');
    await user.click(screen.getByRole('button', { name: 'Record donation' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Campaign not found'));
    expect(screen.getByRole('heading', { name: 'Record Donation' })).toBeInTheDocument();
  });
});
