import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';

const getEmergencyContacts = vi.fn();
const createEmergencyContact = vi.fn();
const updateEmergencyContact = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getEmergencyContacts: (...args: unknown[]) => getEmergencyContacts(...args) as unknown,
    createEmergencyContact: (...args: unknown[]) => createEmergencyContact(...args) as unknown,
    updateEmergencyContact: (...args: unknown[]) => updateEmergencyContact(...args) as unknown,
    deleteEmergencyContact: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ContactsSection from './ContactsSection';

const plumber = {
  id: 'c-1',
  facilityId: 'facility-1',
  contactType: 'plumber',
  companyName: 'Ace Plumbing',
  contactName: 'Dana',
  phone: '555-0100',
  altPhone: null,
  email: null,
  serviceContractNumber: null,
  priority: 1,
};

const renderSection = () => renderWithRouter(<ContactsSection facilityId="facility-1" canCreate canEdit canDelete />);

describe('ContactsSection form', () => {
  beforeEach(() => {
    getEmergencyContacts.mockReset();
    getEmergencyContacts.mockResolvedValue([]);
    createEmergencyContact.mockReset();
    createEmergencyContact.mockResolvedValue({});
    updateEmergencyContact.mockReset();
    updateEmergencyContact.mockResolvedValue({});
  });

  it('flags a contact with neither name on the field, and adds nothing', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: /Add Contact/ }));
    await user.click(screen.getByRole('button', { name: 'Save Contact' }));

    expect(screen.getByLabelText('Company Name')).toHaveAccessibleDescription(
      expect.stringContaining('Enter a company name or a contact name.')
    );
    expect(createEmergencyContact).not.toHaveBeenCalled();
  });

  it('puts a server refusal on its field, announced, and submits on Enter', async () => {
    createEmergencyContact.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'phone', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: /Add Contact/ }));
    await user.type(screen.getByLabelText('Company Name'), 'Ace Plumbing');
    await user.type(screen.getByLabelText('Phone'), '555-0100{Enter}');

    const phone = screen.getByLabelText('Phone');
    await waitFor(() => expect(phone).toHaveAccessibleDescription('Phone is too long — keep it to 50 characters.'));
    expect(phone).toHaveAttribute('maxLength', '50');
  });

  it('saves the rest of an edit and keeps a refused field flagged, open', async () => {
    getEmergencyContacts.mockResolvedValue([plumber]);
    updateEmergencyContact.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'email', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Edit Ace Plumbing' }));
    await user.type(screen.getByLabelText('Email'), 'dana@ace.test');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(updateEmergencyContact).toHaveBeenCalledTimes(2));
    expect(updateEmergencyContact.mock.calls[1]?.[1]).not.toHaveProperty('email');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'Email is too long — keep it to 200 characters.'
    );
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
  });
});
