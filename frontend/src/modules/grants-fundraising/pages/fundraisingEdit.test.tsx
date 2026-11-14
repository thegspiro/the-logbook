/**
 * Lead W69: donors and campaigns could be created but never edited, though
 * their update endpoints worked. Editing reuses each page's create form, and
 * an update sends every field the form owns, with an emptied box as null so
 * the stored value is cleared rather than kept behind a success toast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

const { listDonors, updateDonor, createDonor, listCampaigns, updateCampaign, createCampaign } = vi.hoisted(() => ({
  listDonors: vi.fn(),
  updateDonor: vi.fn(),
  createDonor: vi.fn(),
  listCampaigns: vi.fn(),
  updateCampaign: vi.fn(),
  createCampaign: vi.fn(),
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: () => true };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
vi.mock('../services/api', () => ({
  fundraisingService: {
    listDonors: (...a: unknown[]) => listDonors(...a) as unknown,
    updateDonor: (...a: unknown[]) => updateDonor(...a) as unknown,
    createDonor: (...a: unknown[]) => createDonor(...a) as unknown,
    listCampaigns: (...a: unknown[]) => listCampaigns(...a) as unknown,
    updateCampaign: (...a: unknown[]) => updateCampaign(...a) as unknown,
    createCampaign: (...a: unknown[]) => createCampaign(...a) as unknown,
  },
}));

import CampaignsPage from './CampaignsPage';
import DonorsPage from './DonorsPage';

const DONOR = {
  id: 'd1',
  organizationId: 'o1',
  userId: null,
  firstName: 'Ann',
  lastName: 'Lee',
  email: 'ann@example.org',
  phone: null,
  addressLine1: '1 Main St',
  addressLine2: null,
  city: 'Oakville',
  state: 'VA',
  postalCode: '22046',
  country: 'US',
  donorType: 'individual',
  companyName: null,
  totalDonated: 0,
  donationCount: 0,
  firstDonationDate: null,
  lastDonationDate: null,
  notes: null,
  tags: null,
  communicationPreferences: null,
  isAnonymous: false,
  active: true,
  contactHidden: false,
};

const CAMPAIGN = {
  id: 'c1',
  organizationId: 'o1',
  name: 'Thermal Camera Drive',
  description: 'Two cameras for the engines',
  campaignType: 'equipment',
  status: 'active',
  goalAmount: 25000,
  currentAmount: 0,
  startDate: '2026-10-01',
  endDate: '2026-12-31',
  isRestricted: false,
  restrictionPurpose: null,
};

describe('Donors: Edit (W69)', () => {
  beforeEach(() => {
    listDonors.mockReset();
    listDonors.mockResolvedValue([DONOR]);
    updateDonor.mockReset();
    updateDonor.mockResolvedValue(DONOR);
  });

  it('opens the donor in the form and saves every field, clearing an emptied one', async () => {
    const user = userEvent.setup();
    // The open form asks before discarding, which needs the app shell's ConfirmProvider.
    render(
      <ConfirmProvider>
        <MemoryRouter>
          <DonorsPage />
        </MemoryRouter>
      </ConfirmProvider>
    );

    await user.click(await screen.findByRole('button', { name: 'Edit Ann Lee' }));
    expect(screen.getByRole('heading', { name: 'Edit Donor' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Last Name/)).toHaveValue('Lee');

    await user.clear(screen.getByLabelText(/Last Name/));
    await user.type(screen.getByLabelText(/Last Name/), 'Lee-Park');
    await user.clear(screen.getByLabelText('Email'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(updateDonor).toHaveBeenCalledTimes(1));
    expect(updateDonor).toHaveBeenCalledWith('d1', {
      firstName: 'Ann',
      lastName: 'Lee-Park',
      email: null,
      phone: null,
      donorType: 'individual',
      companyName: null,
      addressLine1: '1 Main St',
      city: 'Oakville',
      state: 'VA',
      postalCode: '22046',
    });
    expect(createDonor).not.toHaveBeenCalled();
  });
});

describe('Campaigns: Edit (W69)', () => {
  beforeEach(() => {
    listCampaigns.mockReset();
    listCampaigns.mockResolvedValue([CAMPAIGN]);
    updateCampaign.mockReset();
    updateCampaign.mockResolvedValue(CAMPAIGN);
  });

  it('saves the campaign details and clears an emptied end date and description', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <MemoryRouter>
          <CampaignsPage />
        </MemoryRouter>
      </ConfirmProvider>
    );

    await user.click(await screen.findByRole('button', { name: 'Edit Thermal Camera Drive' }));
    expect(screen.getByRole('heading', { name: 'Edit Campaign' })).toBeInTheDocument();

    const goal = screen.getByLabelText(/Goal Amount/);
    await user.clear(goal);
    await user.type(goal, '30000');
    await user.clear(screen.getByLabelText(/End Date/));
    await user.clear(screen.getByLabelText(/Description/));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(updateCampaign).toHaveBeenCalledTimes(1));
    // Status and the restriction keep their own controls, so they are not sent.
    expect(updateCampaign).toHaveBeenCalledWith('c1', {
      name: 'Thermal Camera Drive',
      description: null,
      campaignType: 'equipment',
      goalAmount: 30000,
      startDate: '2026-10-01',
      endDate: null,
    });
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it('leaves status and the restriction out of the edit form', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <MemoryRouter>
          <CampaignsPage />
        </MemoryRouter>
      </ConfirmProvider>
    );

    await user.click(await screen.findByRole('button', { name: 'Edit Thermal Camera Drive' }));
    expect(screen.queryByLabelText(/^Status$/, { selector: '#create-status' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Restricted fund — donors/)).not.toBeInTheDocument();
  });
});
