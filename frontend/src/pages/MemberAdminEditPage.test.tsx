/**
 * An administrative member's rank field, on the screen that can change either.
 *
 * The server refuses the pair outright, so the point of the disabled control is
 * that an operator never reaches that 400. The clear matters more than the
 * greying: this page saves in two requests — the profile PATCH, then the
 * membership-type PATCH — so a rank left in the form would be re-asserted by
 * the first request moments before the second one removed the member from the
 * chain of command.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetUserWithRoles = vi.fn();
const mockUpdateUserProfile = vi.fn();
const mockChangeMembershipType = vi.fn();
const mockSetComplianceExemption = vi.fn();
const mockGetLocations = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    getUserWithRoles: (...args: unknown[]) => mockGetUserWithRoles(...args) as unknown,
    updateUserProfile: (...args: unknown[]) => mockUpdateUserProfile(...args) as unknown,
    changeMembershipType: (...args: unknown[]) => mockChangeMembershipType(...args) as unknown,
    setComplianceExemption: (...args: unknown[]) => mockSetComplianceExemption(...args) as unknown,
  },
  locationsService: {
    getLocations: (...args: unknown[]) => mockGetLocations(...args) as unknown,
  },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useParams: () => ({ userId: 'u1' }) };
});

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    rankOptions: [
      { value: 'captain', label: 'Captain' },
      { value: 'firefighter', label: 'Firefighter' },
    ],
    ranks: [],
    loading: false,
    refetch: vi.fn(),
    formatRank: (r: string) => r,
  }),
}));

import { renderWithRouter } from '../test/utils';
import { MemberAdminEditPage } from './MemberAdminEditPage';

const member = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  username: 'dreyes',
  email: 'dreyes@dept.test',
  first_name: 'Dana',
  last_name: 'Reyes',
  full_name: 'Dana Reyes',
  roles: [],
  rank: 'captain',
  station: '',
  platoon: '',
  membership_number: 'FF-001',
  membership_type: 'active',
  emergency_contacts: [],
  ...overrides,
});

const rankSelect = () => screen.getByRole('combobox', { name: /^rank$/i });
const membershipSelect = () => screen.getByRole('combobox', { name: /membership type/i });

const renderPage = async () => {
  renderWithRouter(<MemberAdminEditPage />);
  await waitFor(() => expect(mockGetUserWithRoles).toHaveBeenCalled());
  await screen.findByDisplayValue('Dana');
};

describe('MemberAdminEditPage rank field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLocations.mockResolvedValue([]);
    mockUpdateUserProfile.mockResolvedValue({});
    mockChangeMembershipType.mockResolvedValue({});
    mockGetUserWithRoles.mockResolvedValue(member());
  });

  it('lets an operational member hold a rank', async () => {
    await renderPage();

    expect(rankSelect()).toBeEnabled();
    expect(screen.queryByText(/do not hold an operational rank/i)).not.toBeInTheDocument();
  });

  it('disables and explains the rank field for an administrative member', async () => {
    mockGetUserWithRoles.mockResolvedValue(member({ membership_type: 'administrative', rank: '' }));
    await renderPage();

    expect(rankSelect()).toBeDisabled();
    expect(screen.getByText(/do not hold an operational rank/i)).toBeInTheDocument();
  });

  it('leaves the rank field alone for a member on a custom membership tier', async () => {
    // `membership_type` doubles as an org-configurable tier id. A tier the
    // vocabulary does not know is not administrative, and greying its rank
    // would break every department that configured one.
    mockGetUserWithRoles.mockResolvedValue(member({ membership_type: 'senior' }));
    await renderPage();

    expect(rankSelect()).toBeEnabled();
  });

  it('disables the rank field when the member is switched to administrative', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.selectOptions(membershipSelect(), 'administrative');

    await waitFor(() => expect(rankSelect()).toBeDisabled());
    expect(screen.getByText(/do not hold an operational rank/i)).toBeInTheDocument();
  });

  it('does not send the rank when only the membership type changed', async () => {
    // The rank must not go out in the profile PATCH. That request lands first,
    // and the membership-type PATCH behind it can legitimately fail — it
    // rejects a tier the organization has not configured — which would leave
    // the member operational and stripped of a rank nobody agreed to remove.
    // The membership-type endpoint clears it in the same transaction instead.
    const user = userEvent.setup();
    await renderPage();

    await user.selectOptions(membershipSelect(), 'administrative');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockChangeMembershipType).toHaveBeenCalled());
    expect(mockChangeMembershipType).toHaveBeenCalledWith('u1', 'administrative');
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('keeps the rank when the membership-type change is rejected', async () => {
    const user = userEvent.setup();
    mockChangeMembershipType.mockRejectedValue({
      response: { status: 400, data: { detail: "Invalid membership tier 'administrative'" } },
    });
    await renderPage();

    await user.selectOptions(membershipSelect(), 'administrative');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/invalid membership tier/i)).toBeInTheDocument();
    // Nothing was persisted about the rank, so the member is still a Captain.
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });
});
