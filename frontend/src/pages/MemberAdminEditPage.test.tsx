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
const mockGetTierConfig = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    getUserWithRoles: (...args: unknown[]) => mockGetUserWithRoles(...args) as unknown,
    updateUserProfile: (...args: unknown[]) => mockUpdateUserProfile(...args) as unknown,
    changeMembershipType: (...args: unknown[]) => mockChangeMembershipType(...args) as unknown,
    setComplianceExemption: (...args: unknown[]) => mockSetComplianceExemption(...args) as unknown,
  },
  memberStatusService: {
    getTierConfig: (...args: unknown[]) => mockGetTierConfig(...args) as unknown,
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
  member_class: 'operational',
  member_status: 'regular',
  emergency_contacts: [],
  ...overrides,
});

const rankSelect = () => screen.getByRole('combobox', { name: /^rank$/i });
const classSelect = () => screen.getByRole('combobox', { name: /member class/i });
const statusSelect = () => screen.getByRole('combobox', { name: /membership status/i });

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
    mockGetTierConfig.mockReset();
    mockGetTierConfig.mockResolvedValue({ auto_advance: true, tiers: [] });
    mockGetUserWithRoles.mockResolvedValue(member());
  });

  it('lets an operational member hold a rank', async () => {
    await renderPage();

    expect(rankSelect()).toBeEnabled();
    expect(screen.queryByText(/do not hold an operational rank/i)).not.toBeInTheDocument();
  });

  it('disables and explains the rank field for an administrative member', async () => {
    mockGetUserWithRoles.mockResolvedValue(
      member({ membership_type: 'administrative', member_class: 'administrative', rank: '' })
    );
    await renderPage();

    expect(rankSelect()).toBeDisabled();
    expect(screen.getByText(/do not hold an operational rank/i)).toBeInTheDocument();
  });

  it('leaves the rank field alone for a member on a custom membership tier', async () => {
    // A department tier (`senior`) is a standing, not a class. An operational
    // member on one keeps their rank; the status control shows the tier.
    mockGetUserWithRoles.mockResolvedValue(member({ membership_type: 'senior', member_status: 'senior' }));
    await renderPage();

    expect(rankSelect()).toBeEnabled();
    expect(statusSelect()).toHaveValue('senior');
  });

  it('reads the pair from the legacy value for a row written before it existed', async () => {
    mockGetUserWithRoles.mockResolvedValue(
      member({ membership_type: 'life', member_class: null, member_status: null })
    );
    await renderPage();

    expect(classSelect()).toHaveValue('operational');
    expect(statusSelect()).toHaveValue('life');
  });

  it('can state an administrative life member, which one dropdown could not', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.selectOptions(classSelect(), 'administrative');
    await user.selectOptions(statusSelect(), 'life');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    const payload = mockUpdateUserProfile.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.member_class).toBe('administrative');
    expect(payload.member_status).toBe('life');
    expect(mockChangeMembershipType).not.toHaveBeenCalled();
  });

  it('disables the rank field when the member is switched to administrative', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.selectOptions(classSelect(), 'administrative');

    await waitFor(() => expect(rankSelect()).toBeDisabled());
    expect(screen.getByText(/do not hold an operational rank/i)).toBeInTheDocument();
  });

  it('sends class and status together, with the rank cleared, in the one profile save', async () => {
    // One request, not two: the pair and the rank land in the same PATCH, so
    // a refused pair (an unknown tier) leaves the rank exactly as it was, and
    // the server never sees a rank on an administrative member.
    const user = userEvent.setup();
    await renderPage();

    await user.selectOptions(classSelect(), 'administrative');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    const payload = mockUpdateUserProfile.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.member_class).toBe('administrative');
    expect(payload.member_status).toBe('regular');
    expect(payload.rank).toBe('');
    expect(mockChangeMembershipType).not.toHaveBeenCalled();
  });

  it('keeps the rank when the classification change is rejected', async () => {
    const user = userEvent.setup();
    mockUpdateUserProfile.mockRejectedValue({
      response: { status: 400, data: { detail: "Unknown member_status 'cadet'" } },
    });
    await renderPage();

    await user.selectOptions(classSelect(), 'administrative');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/unknown member_status/i)).toBeInTheDocument();
    // The one request was refused whole, so nothing about the member changed.
    expect(mockUpdateUserProfile).toHaveBeenCalledTimes(1);
  });
});

describe('MemberAdminEditPage — clearing a date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLocations.mockResolvedValue([]);
    mockUpdateUserProfile.mockResolvedValue({});
    mockChangeMembershipType.mockResolvedValue({});
    mockGetTierConfig.mockReset();
    mockGetTierConfig.mockResolvedValue({ auto_advance: true, tiers: [] });
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

// Update payloads are dumped with exclude_unset, so '' was written through
// as an empty string rather than a clear: the street "cleared" in the
// workflow re-check came back as "" while the dates beside it came back null
// (MR-5). Each optional text field now sends null, as the dates do.
describe('MemberAdminEditPage — clearing a text field', () => {
  const filled = {
    middle_name: 'Lee',
    personal_email: 'dana@home.test',
    membership_number: 'FF-001',
    station: 'Station 1',
    platoon: 'B',
    phone: '703-555-0101',
    mobile: '703-555-0102',
    address_street: '12 Elm St',
    address_city: 'Falls Church',
    address_state: 'VA',
    address_zip: '22046',
    address_country: 'USA',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLocations.mockReset();
    mockGetLocations.mockResolvedValue([{ id: 's1', name: 'Station 1' }]);
    mockUpdateUserProfile.mockReset();
    mockUpdateUserProfile.mockResolvedValue({});
    mockChangeMembershipType.mockResolvedValue({});
    mockGetTierConfig.mockReset();
    mockGetTierConfig.mockResolvedValue({ auto_advance: true, tiers: [] });
    mockGetUserWithRoles.mockReset();
    mockGetUserWithRoles.mockResolvedValue(member(filled));
  });

  it('sends null for every optional text field that is emptied', async () => {
    const user = userEvent.setup();
    await renderPage();

    for (const [field, value] of Object.entries(filled)) {
      if (field === 'station') continue;
      await user.clear(screen.getByDisplayValue(value));
    }
    await user.selectOptions(screen.getByRole('combobox', { name: /^station$/i }), '');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    const payload = mockUpdateUserProfile.mock.calls[0]?.[1] as Record<string, unknown>;
    for (const field of Object.keys(filled)) {
      expect(payload).toHaveProperty(field, null);
    }
  });

  it('still sends a value that was changed, trimmed', async () => {
    const user = userEvent.setup();
    await renderPage();

    const platoon = screen.getByDisplayValue('B');
    await user.clear(platoon);
    await user.type(platoon, ' C ');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalled());
    const payload = mockUpdateUserProfile.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.platoon).toBe('C');
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
    mockGetTierConfig.mockReset();
    mockGetTierConfig.mockResolvedValue({ auto_advance: true, tiers: [] });
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
