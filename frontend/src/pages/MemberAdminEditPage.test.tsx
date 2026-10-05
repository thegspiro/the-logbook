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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Empty by default, so every suite that predates the ID Cards section renders
// the page exactly as it did before the section existed.
let grantedPermissions: string[] = [];

vi.mock('../stores/authStore', () => {
  const state = {
    checkPermission: (permission: string) => grantedPermissions.includes(permission),
  };
  // The page and Breadcrumbs both read the store through a selector.
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('../modules/membership/components/MemberIdCardsPanel', () => ({
  MemberIdCardsPanel: ({ userId, memberName }: { userId: string; memberName?: string }) => (
    <section aria-label="ID cards panel">
      {userId}|{memberName}
    </section>
  ),
}));

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

describe('MemberAdminEditPage — emergency contacts', () => {
  beforeEach(() => {
    mockGetUserWithRoles.mockReset();
    mockUpdateUserProfile.mockReset();
    mockGetLocations.mockReset();
    mockGetLocations.mockResolvedValue([]);
    mockUpdateUserProfile.mockResolvedValue({});
    mockGetUserWithRoles.mockResolvedValue(
      member({
        emergency_contacts: [
          { name: 'Pat Reyes', relationship: 'Spouse', phone: '555-0100', email: 'pat@example.org', is_primary: true },
        ],
      })
    );
  });

  it('adds a contact with no email instead of sending an empty string', async () => {
    // `EmergencyContact.email` is `EmailStr | None`, so '' was a 422 and the
    // new contact was lost.
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /add contact/i }));
    await user.type(screen.getAllByRole('textbox', { name: /^name$/i })[1] ?? document.body, ' Sam Reyes ');
    await user.type(screen.getAllByRole('textbox', { name: /relationship/i })[1] ?? document.body, 'Brother');
    await user.type(screen.getAllByRole('textbox', { name: /^phone$/i })[2] ?? document.body, '555-0101');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    const payload = JSON.parse(JSON.stringify(mockUpdateUserProfile.mock.calls[0]?.[1])) as {
      emergency_contacts: Record<string, unknown>[];
    };
    expect(payload.emergency_contacts).toEqual([
      { name: 'Pat Reyes', relationship: 'Spouse', phone: '555-0100', email: 'pat@example.org', is_primary: true },
      { name: 'Sam Reyes', relationship: 'Brother', phone: '555-0101', is_primary: false },
    ]);
  });

  it('names the incomplete contact and sends nothing', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /add contact/i }));
    await user.type(screen.getAllByRole('textbox', { name: /^name$/i })[1] ?? document.body, 'Sam Reyes');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('Emergency contact 2 needs a name and a relationship.')).toBeInTheDocument();
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('labels every field on the page', async () => {
    await renderPage();
    expect(screen.getByRole('textbox', { name: /first name/i })).toHaveValue('Dana');
    expect(screen.getByRole('textbox', { name: /membership number/i })).toHaveValue('FF-001');
    expect(screen.getByRole('combobox', { name: /station/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /street address/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^relationship$/i })).toHaveValue('Spouse');
  });
});

describe('MemberAdminEditPage — preferred name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLocations.mockReset();
    mockGetLocations.mockResolvedValue([]);
    mockUpdateUserProfile.mockReset();
    mockUpdateUserProfile.mockResolvedValue({});
    mockChangeMembershipType.mockReset();
    mockChangeMembershipType.mockResolvedValue({});
    mockGetUserWithRoles.mockReset();
    mockGetUserWithRoles.mockResolvedValue(member({ preferred_name: 'Dee' }));
  });

  const payload = () => mockUpdateUserProfile.mock.calls[0]?.[1] as Record<string, unknown>;

  it('heads the page with the name the member goes by', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /Dee Reyes/ })).toBeInTheDocument();
  });

  it('leaves the preferred name out of a save that did not change it', async () => {
    const user = userEvent.setup();
    await renderPage();

    const lastName = screen.getByRole('textbox', { name: /last name/i });
    await user.clear(lastName);
    await user.type(lastName, 'Reyes-Ortiz');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    expect(payload()).toHaveProperty('last_name', 'Reyes-Ortiz');
    expect(payload()).not.toHaveProperty('preferred_name');
  });

  it('sends a changed preferred name', async () => {
    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByRole('textbox', { name: /preferred name/i });
    await user.clear(input);
    await user.type(input, 'Danny');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    expect(payload()).toHaveProperty('preferred_name', 'Danny');
  });

  it('sends null when the preferred name is cleared', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.clear(screen.getByRole('textbox', { name: /preferred name/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    expect(JSON.parse(JSON.stringify(payload()))).toHaveProperty('preferred_name', null);
  });
});

describe('MemberAdminEditPage — ID cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLocations.mockReset();
    mockGetLocations.mockResolvedValue([]);
    mockGetUserWithRoles.mockReset();
    mockGetUserWithRoles.mockResolvedValue(member());
    grantedPermissions = [];
  });

  afterEach(() => {
    grantedPermissions = [];
  });

  const panel = () => screen.queryByRole('region', { name: 'ID cards panel' });

  it('offers the ID cards section to an officer who can issue cards', async () => {
    grantedPermissions = ['members.manage_id_cards'];
    await renderPage();

    expect(panel()).toHaveTextContent('u1|Dana Reyes');
  });

  it('hides the section from a profile editor who cannot issue cards', async () => {
    // The route admits members.manage; that alone must not surface a panel
    // whose every request the server would refuse.
    grantedPermissions = ['members.manage'];
    await renderPage();

    expect(panel()).not.toBeInTheDocument();
  });

  it('sits after the Save row, outside the form that Save Changes submits', async () => {
    grantedPermissions = ['members.manage_id_cards'];
    await renderPage();

    const save = screen.getByRole('button', { name: 'Save Changes' });
    const section = screen.getByRole('region', { name: 'ID cards panel' });
    expect(save.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
