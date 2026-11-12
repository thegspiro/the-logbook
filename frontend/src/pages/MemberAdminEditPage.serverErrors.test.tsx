/**
 * The member admin edit page under the owner's single-save rule (2026-11-05):
 * a value the record refuses is flagged on its field and left out, and the
 * rest of the save goes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetUserWithRoles = vi.fn();
const mockUpdateUserProfile = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    getUserWithRoles: (...args: unknown[]) => mockGetUserWithRoles(...args) as unknown,
    updateUserProfile: (...args: unknown[]) => mockUpdateUserProfile(...args) as unknown,
    setComplianceExemption: vi.fn(),
  },
  memberStatusService: { getTierNames: vi.fn().mockResolvedValue([]) },
  locationsService: { getLocations: vi.fn().mockResolvedValue([]) },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useParams: () => ({ userId: 'u1' }), useNavigate: () => mockNavigate };
});

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({ rankOptions: [], ranks: [], loading: false, refetch: vi.fn(), formatRank: (r: string) => r }),
}));

import { renderWithRouter } from '../test/utils';
import { MemberAdminEditPage } from './MemberAdminEditPage';

const member = {
  id: 'u1',
  username: 'dreyes',
  email: 'dreyes@dept.test',
  first_name: 'Dana',
  middle_name: 'Lee',
  last_name: 'Reyes',
  roles: [],
  rank: '',
  phone: '703-555-0101',
  member_class: 'operational',
  member_status: 'regular',
  emergency_contacts: [{ name: 'Pat Reyes', relationship: 'Spouse', phone: '555-0100', email: '', is_primary: true }],
};

const renderPage = async () => {
  renderWithRouter(<MemberAdminEditPage />);
  await screen.findByDisplayValue('Dana');
};

describe('MemberAdminEditPage › refusals on their fields', () => {
  beforeEach(() => {
    mockGetUserWithRoles.mockReset();
    mockGetUserWithRoles.mockResolvedValue(member);
    mockUpdateUserProfile.mockReset();
    mockUpdateUserProfile.mockResolvedValue({});
    mockNavigate.mockReset();
  });

  it('flags a refused phone, keeps what was typed and saves the rest', async () => {
    mockUpdateUserProfile.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'phone', message: 'String should have at most 20 characters' }] },
      },
    });
    const user = userEvent.setup();
    await renderPage();

    const middle = screen.getByLabelText(/^Middle Name/);
    await user.clear(middle);
    await user.type(middle, 'Quinn');
    const phone = screen.getByLabelText(/^Phone/, { selector: '#member-phone' });
    await user.clear(phone);
    await user.type(phone, '703-555-0101 ext 4400');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalledTimes(2));
    const retry = mockUpdateUserProfile.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(retry).toHaveProperty('middle_name', 'Quinn');
    expect(retry).not.toHaveProperty('phone');
    await waitFor(() =>
      expect(screen.getByLabelText(/^Phone/, { selector: '#member-phone' })).toHaveAccessibleDescription(
        'Phone is too long — keep it to 20 characters.'
      )
    );
    expect(screen.getByLabelText(/^Phone/, { selector: '#member-phone' })).toHaveValue('703-555-0101 ext 4400');
    expect(screen.getByRole('alert')).toHaveTextContent('Phone was not saved.');
  });

  it("puts a refused contact email on that contact's Email field", async () => {
    mockUpdateUserProfile.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'emergency_contacts.0.email', message: 'value is not a valid email address' }] },
      },
    });
    const user = userEvent.setup();
    await renderPage();

    const email = screen.getByLabelText(/^Email$/);
    await user.type(email, 'pat-at-home');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByLabelText(/^Email$/)).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText(/^Email$/)).toHaveAccessibleDescription('value is not a valid email address');
  });

  it('asks before Cancel leaves a changed page', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.type(screen.getByLabelText(/^Middle Name/), 'x');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Middle Name/)).toHaveValue('Leex');
  });
});
