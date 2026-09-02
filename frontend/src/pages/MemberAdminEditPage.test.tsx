/**
 * An administrative member's rank field, on the screen that can change either.
 *
 * The server refuses the pair outright, so the disabled control exists so that
 * an operator never reaches that 400. What it must NOT do is clear the rank
 * itself: this page saves in two requests — the profile PATCH, then the
 * membership-type PATCH — so a cleared rank would be persisted by the first
 * request before the second one justified it, and that second request can
 * legitimately fail on a tier the organization has not configured. The rank is
 * therefore left untouched in the form (so `handleSave` omits it entirely) and
 * cleared server-side, in the same transaction as the class change.
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

describe('MemberAdminEditPage — clearing a date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLocations.mockResolvedValue([]);
    mockUpdateUserProfile.mockResolvedValue({});
    mockChangeMembershipType.mockResolvedValue({});
    mockGetUserWithRoles.mockResolvedValue(member({ date_of_birth: '1980-01-01', hire_date: '2015-06-01' }));
  });

  it('sends an explicit null, not the empty string the input yields', async () => {
    // `Optional[date]` rejects '' with a 422, so the field could never be
    // cleared — and the 422's array-shaped `detail` then took the page down.
    const user = userEvent.setup();
    await renderPage();

    await user.clear(screen.getByDisplayValue('1980-01-01'));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    const payload = mockUpdateUserProfile.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.date_of_birth).toBeNull();
    expect(JSON.parse(JSON.stringify(payload))).toHaveProperty('date_of_birth', null);
  });

  it('clears the hire date the same way', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.clear(screen.getByDisplayValue('2015-06-01'));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    const payload = mockUpdateUserProfile.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.hire_date).toBeNull();
  });

  it('renders a 422 as a sentence instead of crashing the page', async () => {
    // FastAPI's validation handler answers with an array. Assigned straight to
    // state typed `string | null` it reached the JSX as an array, and React
    // threw "Objects are not valid as a React child" — the ErrorBoundary
    // replaced the whole page rather than showing the message.
    const user = userEvent.setup();
    mockUpdateUserProfile.mockRejectedValue({
      response: { status: 422, data: { detail: [{ field: 'date_of_birth', message: 'Invalid date format.' }] } },
    });
    await renderPage();

    await user.clear(screen.getByDisplayValue('1980-01-01'));
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/date_of_birth: Invalid date format\./)).toBeInTheDocument();
  });
});
