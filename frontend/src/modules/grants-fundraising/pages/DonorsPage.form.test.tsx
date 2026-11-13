/**
 * The inline Add / Edit Donor form: each refusal on its field, the single-save
 * rule on edit, and Cancel asking before typed changes are thrown away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockListDonors = vi.fn();
const mockCreateDonor = vi.fn();
const mockUpdateDonor = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: (_permission: string) => true };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => mockToastSuccess(...a) as unknown, error: vi.fn() },
}));
vi.mock('../services/api', () => ({
  fundraisingService: {
    listDonors: (...args: unknown[]) => mockListDonors(...args) as unknown,
    createDonor: (...args: unknown[]) => mockCreateDonor(...args) as unknown,
    updateDonor: (...args: unknown[]) => mockUpdateDonor(...args) as unknown,
  },
}));

import DonorsPage from './DonorsPage';

const DONOR = {
  id: 'd1',
  organizationId: 'o1',
  firstName: 'Pat',
  lastName: 'Quinn',
  email: 'pat@example.com',
  phone: null,
  addressLine1: null,
  city: null,
  state: null,
  postalCode: null,
  donorType: 'individual',
  companyName: null,
  totalDonated: 250,
  donationCount: 1,
  lastDonationDate: null,
  active: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('DonorsPage form', () => {
  beforeEach(() => {
    mockListDonors.mockReset();
    mockListDonors.mockResolvedValue([DONOR]);
    mockCreateDonor.mockReset();
    mockCreateDonor.mockResolvedValue({});
    mockUpdateDonor.mockReset();
    mockUpdateDonor.mockResolvedValue({});
    mockToastSuccess.mockReset();
  });

  const openAdd = async () => {
    const user = userEvent.setup();
    renderWithRouter(<DonorsPage />);
    await screen.findByText('Pat Quinn');
    await user.click(screen.getByRole('button', { name: /Add Donor/ }));
    return user;
  };

  it('names each missing name on its field and adds nothing', async () => {
    const user = await openAdd();
    await user.click(screen.getByRole('button', { name: 'Save Donor' }));

    expect(screen.getByLabelText(/^First Name/)).toHaveAccessibleDescription("Enter the donor's first name.");
    expect(screen.getByLabelText(/^Last Name/)).toHaveAccessibleDescription("Enter the donor's last name.");
    expect(mockCreateDonor).not.toHaveBeenCalled();
  });

  it('puts a refused email on its field, announced, with its limit', async () => {
    mockCreateDonor.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'email', message: 'Value is too long.' }] } },
    });
    const user = await openAdd();
    await user.type(screen.getByLabelText(/^First Name/), 'Sam');
    await user.type(screen.getByLabelText(/^Last Name/), 'Lee');
    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.click(screen.getByRole('button', { name: 'Save Donor' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
        'Email is too long — keep it to 255 characters.'
      )
    );
    expect(screen.getByLabelText('Email')).toHaveAttribute('maxLength', '255');
  });

  it('saves the rest of an edit and keeps a refused field flagged', async () => {
    mockUpdateDonor
      .mockRejectedValueOnce({
        response: { status: 422, data: { detail: [{ field: 'phone', message: 'Value is too long.' }] } },
      })
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    renderWithRouter(<DonorsPage />);
    await screen.findByText('Pat Quinn');
    await user.click(screen.getByRole('button', { name: /Edit Pat Quinn/ }));
    await user.type(screen.getByLabelText('Phone'), '555-0100');
    await user.type(screen.getByLabelText('City'), 'Falls');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateDonor).toHaveBeenCalledTimes(2));
    expect(mockUpdateDonor.mock.calls[1]?.[1]).not.toHaveProperty('phone');
    expect(mockUpdateDonor.mock.calls[1]?.[1]).toMatchObject({ city: 'Falls' });
    expect(screen.getByRole('alert')).toHaveTextContent('Donor saved, except phone.');
    expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription('Phone is too long — keep it to 20 characters.');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws typed changes away', async () => {
    const user = await openAdd();
    await user.type(screen.getByLabelText(/^First Name/), 'Sam');
    const [, formCancel] = screen.getAllByRole('button', { name: /Cancel/ });
    await user.click(formCancel as HTMLElement);
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText(/^First Name/)).toHaveValue('Sam');
  });
});
