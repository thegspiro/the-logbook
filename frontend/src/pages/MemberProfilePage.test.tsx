/**
 * A member profile is a directory card: the contact details a colleague is
 * meant to be able to look up. The gear a member signed for is not part of
 * that — it is quartermaster business, and it used to be rendered (and
 * fetched) for anyone who opened the page, because the section was gated on
 * "is the inventory module enabled" alone. `inventory.view` cannot be the gate
 * either: every member holds it as part of the baseline Member position.
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test/utils';
import type { UserWithRoles } from '../types/role';
import { UserStatus } from '../constants/enums';

const VIEWER_ID = 'viewer-1';
const TARGET_ID = 'target-2';

let routeUserId = TARGET_ID;
let grantedPermissions: string[] = [];

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useParams: () => ({ userId: routeUserId }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: VIEWER_ID },
    checkPermission: (permission: string) => grantedPermissions.includes(permission),
  }),
}));

vi.mock('../modules/membership/components/MemberIdCardsPanel', () => ({
  MemberIdCardsPanel: () => null,
}));

// Pin the department timezone so assigned-date formatting is stable and does
// not depend on the org-settings store the page normally reads it from.
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

const getUserInventory = vi.fn();
const getEnabledModules = vi.fn();
const getUserWithRoles = vi.fn();
const setMyProfileVisibility = vi.fn();
const checkContactInfoEnabled = vi.fn();
const reactivateMember = vi.fn();
const getServiceHistory = vi.fn();
const changeStatus = vi.fn();
let nfcIdCardsConnected = false;

vi.mock('../hooks/useConnectedIntegrations', () => ({
  useConnectedIntegrations: () => ({
    connected: new Set(nfcIdCardsConnected ? ['nfc-id-cards'] : []),
    loading: false,
    isConnected: (type: string) => type === 'nfc-id-cards' && nfcIdCardsConnected,
  }),
}));

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    ranks: [],
    rankOptions: [],
    loading: false,
    refetch: vi.fn(),
    formatRank: (code: string | null | undefined) => (code === 'captain' ? 'Captain' : (code ?? '')),
  }),
}));

vi.mock('../services/api', () => ({
  userService: {
    getUserWithRoles: (...args: unknown[]) => getUserWithRoles(...args) as unknown,
    getUserConsents: () => Promise.resolve([]),
    checkContactInfoEnabled: (...args: unknown[]) => checkContactInfoEnabled(...args) as unknown,
    getMyProfileVisibility: () =>
      Promise.resolve({ email: true, personal_email: false, phone: true, mobile: true, address: false }),
    setMyProfileVisibility: (...args: unknown[]) => setMyProfileVisibility(...args) as unknown,
  },
  organizationService: {
    getEnabledModules: () => getEnabledModules() as unknown,
  },
  trainingService: {
    getRecords: () => Promise.resolve([]),
    getComplianceSummary: () => Promise.resolve(null),
  },
  inventoryService: {
    getUserInventory: (...args: unknown[]) => getUserInventory(...args) as unknown,
  },
  memberStatusService: {
    getMemberLeaves: () => Promise.resolve([]),
    reactivateMember: (...args: unknown[]) => reactivateMember(...args) as unknown,
    getServiceHistory: (...args: unknown[]) => getServiceHistory(...args) as unknown,
    changeStatus: (...args: unknown[]) => changeStatus(...args) as unknown,
  },
}));

vi.mock('../modules/admin-hours/services/api', () => ({
  adminHoursEntryService: { getSummary: () => Promise.resolve(null) },
  adminHoursComplianceService: { getUserCompliance: () => Promise.resolve([]) },
}));

const targetUser: UserWithRoles = {
  id: TARGET_ID,
  organization_id: 'org-1',
  username: 'jdoe',
  first_name: 'Jane',
  last_name: 'Doe',
  status: UserStatus.ACTIVE,
  roles: [],
};

// Imported after the mocks so the page picks them up.
const { MemberProfilePage } = await import('./MemberProfilePage');

describe('MemberProfilePage assigned inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeUserId = TARGET_ID;
    grantedPermissions = [];
    getUserWithRoles.mockReset();
    getUserWithRoles.mockResolvedValue(targetUser);
    checkContactInfoEnabled.mockReset();
    checkContactInfoEnabled.mockResolvedValue({ enabled: true, show_email: true, show_phone: true, show_mobile: true });
    getEnabledModules.mockResolvedValue({ enabled_modules: ['inventory'] });
    getUserInventory.mockResolvedValue({
      permanent_assignments: [
        {
          assignment_id: 'a-1',
          item_name: 'Turnout Coat',
          serial_number: 'SN-1',
          asset_tag: null,
          condition: 'Good',
          assigned_date: '2026-01-05T00:00:00Z',
        },
      ],
    });
  });

  it('hides a colleague’s gear from a member without inventory.manage', async () => {
    renderWithRouter(<MemberProfilePage />);

    // Quick Stats is hidden from a plain viewer (nothing in it is theirs to
    // see), so the name heading is the render anchor.
    await screen.findByRole('heading', { name: 'jdoe' });
    await waitFor(() => expect(getEnabledModules).toHaveBeenCalled());
    // Let the module-enabled state settle; the inventory fetch would fire on
    // the commit that follows it.
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

    expect(screen.queryByText('Assigned Inventory')).not.toBeInTheDocument();
    expect(screen.queryByText('Turnout Coat')).not.toBeInTheDocument();
    // The section is not merely hidden — the read never leaves the browser.
    expect(getUserInventory).not.toHaveBeenCalled();
  });

  it('shows a colleague’s gear to a quartermaster', async () => {
    grantedPermissions = ['inventory.manage'];

    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText('Assigned Inventory')).toBeInTheDocument();
    expect(await screen.findByText('Turnout Coat')).toBeInTheDocument();
    expect(getUserInventory).toHaveBeenCalledWith(TARGET_ID);
  });

  it('shows a member their own gear without any inventory permission', async () => {
    routeUserId = VIEWER_ID;

    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText('Assigned Inventory')).toBeInTheDocument();
    // Wait for an item, not just the heading, before asserting the fetch. The
    // heading renders on the commit where `inventoryModuleEnabled` flips true;
    // the effect that calls `getUserInventory` runs after that commit, so
    // asserting here on the heading alone races the fetch and intermittently
    // sees zero calls. An item cannot appear until the response has landed.
    expect(await screen.findByText('Turnout Coat')).toBeInTheDocument();
    expect(getUserInventory).toHaveBeenCalledWith(VIEWER_ID);
  });
});

const shareNothing = {
  email: false,
  personal_email: false,
  phone: false,
  mobile: false,
  address: false,
};

/** What the backend hands a plain colleague: contact block blanked, choice object nulled. */
const redactedColleague: UserWithRoles = {
  ...targetUser,
  rank: 'captain',
  membership_type: 'life',
  station: 'Station 6',
  platoon: 'B',
  hire_date: '2019-03-02',
  profile_visibility: null,
};

/** Five years, a gap, then back since 2024 with the clock restarted. */
const RETURNED_HISTORY = {
  user_id: TARGET_ID,
  hire_date: '2015-09-24',
  periods: [
    {
      id: 'p1',
      start_date: '2015-09-24',
      start_is_hire_date: true,
      end_date: '2020-09-24',
      separation_status: 'dropped_voluntary',
      counts_toward_service: false,
      notes: null,
      days: 1827,
    },
    {
      id: 'p2',
      start_date: '2024-09-24',
      start_is_hire_date: false,
      end_date: null,
      separation_status: null,
      counts_toward_service: true,
      notes: null,
      days: 730,
    },
  ],
  credited_days: 730,
  credited_years: 2,
  prior_days: 1827,
  effective_service_start: '2024-09-24',
  is_recorded: true,
  is_estimated: false,
  default_rejoin_credit: 'continue',
};

describe('MemberProfilePage membership and privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeUserId = TARGET_ID;
    grantedPermissions = [];
    getUserWithRoles.mockReset();
    getUserWithRoles.mockResolvedValue(redactedColleague);
    checkContactInfoEnabled.mockReset();
    checkContactInfoEnabled.mockResolvedValue({ enabled: true, show_email: true, show_phone: true, show_mobile: true });
    nfcIdCardsConnected = false;
    getEnabledModules.mockResolvedValue({ enabled_modules: [] });
    getUserInventory.mockResolvedValue({ permanent_assignments: [] });
    setMyProfileVisibility.mockReset();
    setMyProfileVisibility.mockImplementation((v: unknown) => Promise.resolve(v));
    getServiceHistory.mockReset();
    getServiceHistory.mockResolvedValue(RETURNED_HISTORY);
    changeStatus.mockReset();
    changeStatus.mockResolvedValue({ user_id: TARGET_ID, previous_status: 'retired', new_status: 'active' });
  });

  it('describes a colleague by rank and member type, not employment status', async () => {
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText('Captain · Life member')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Membership' })).toBeInTheDocument();
    expect(screen.getByText('Station 6')).toBeInTheDocument();
    expect(screen.getByText('Member since')).toBeInTheDocument();
    expect(screen.queryByText('Employment')).not.toBeInTheDocument();
    // An ordinary active status is leadership's concern, not a badge for colleagues.
    expect(screen.queryByText('active')).not.toBeInTheDocument();
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
  });

  it('hides a redacted address and an empty Quick Stats from a colleague, in a two-column layout', async () => {
    renderWithRouter(<MemberProfilePage />);

    await screen.findByRole('heading', { name: 'jdoe' });
    expect(screen.queryByText('Address')).not.toBeInTheDocument();
    expect(screen.queryByText('No address on file.')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick Stats')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-grid-two')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows an address the member chose to share', async () => {
    getUserWithRoles.mockResolvedValue({
      ...redactedColleague,
      address_street: '12 Ladder Lane',
      address_city: 'Oakville',
      address_state: 'VA',
      address_zip: '22046',
    });
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText(/12 Ladder Lane/)).toBeInTheDocument();
    expect(screen.getByText('Address')).toBeInTheDocument();
  });

  it('shows a shared address that has only a ZIP code', async () => {
    getUserWithRoles.mockResolvedValue({ ...redactedColleague, address_zip: '22046' });
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText(/22046/)).toBeInTheDocument();
    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.queryByText('No address on file.')).not.toBeInTheDocument();
  });

  it('still badges a member who is not active', async () => {
    getUserWithRoles.mockResolvedValue({ ...redactedColleague, status: UserStatus.LEAVE });
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText('leave')).toBeInTheDocument();
  });

  it('lets a member flip what colleagues see, saving the whole choice each time', async () => {
    routeUserId = VIEWER_ID;
    getUserWithRoles.mockResolvedValue({
      ...redactedColleague,
      id: VIEWER_ID,
      email: 'jdoe@example.com',
      address_street: '12 Ladder Lane',
      address_city: 'Oakville',
      profile_visibility: shareNothing,
    });
    renderWithRouter(<MemberProfilePage />);

    const addressSwitch = await screen.findByRole('switch', { name: 'Mailing address visibility' });
    expect(addressSwitch).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Email visibility' })).toBeInTheDocument();
    expect(screen.getByTestId('profile-grid-three')).toBeInTheDocument();

    await userEvent.click(addressSwitch);

    await waitFor(() => expect(setMyProfileVisibility).toHaveBeenCalledWith({ ...shareNothing, address: true }));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage what other members see' })).toHaveAttribute(
      'href',
      '/account?tab=privacy'
    );
  });

  it('shows a members-manager the status control and read-only visibility badges', async () => {
    grantedPermissions = ['members.manage'];
    getUserWithRoles.mockResolvedValue({
      ...redactedColleague,
      email: 'jdoe@example.com',
      address_street: '12 Ladder Lane',
      profile_visibility: { ...shareNothing, email: true },
    });
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByTitle('Change member status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change status' })).toBeInTheDocument();
    expect(screen.getByText('Visible to members')).toBeInTheDocument();
    expect(screen.getByText('Only you and leadership')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('does not offer Archived as an ordinary status change', async () => {
    grantedPermissions = ['members.manage'];
    renderWithRouter(<MemberProfilePage />);

    await userEvent.click(await screen.findByTitle('Change member status'));

    const select = await screen.findByRole('combobox');
    expect(within(select).getByRole('option', { name: 'Dropped Voluntary' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Archived' })).not.toBeInTheDocument();
  });

  it('turns the status control into Reactivate for an archived member', async () => {
    grantedPermissions = ['members.manage'];
    reactivateMember.mockReset();
    reactivateMember.mockResolvedValue({ user_id: TARGET_ID, new_status: UserStatus.ACTIVE });
    getUserWithRoles.mockResolvedValue({ ...redactedColleague, status: UserStatus.ARCHIVED });
    renderWithRouter(<MemberProfilePage />);

    // Both status controls -- the header pill and the Membership card's pencil -- lead here.
    const controls = await screen.findAllByTitle('Reactivate member');
    expect(controls).toHaveLength(2);
    await userEvent.click(controls[0] ?? document.body);
    expect(await screen.findByRole('heading', { name: 'Reactivate Member' })).toBeInTheDocument();
    expect(screen.queryByText('Change Member Status')).not.toBeInTheDocument();

    await screen.findByRole('group', { name: /Earlier service/ });
    const fetchesBefore = getUserWithRoles.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() =>
      expect(reactivateMember).toHaveBeenCalledWith(
        TARGET_ID,
        expect.objectContaining({ reason: undefined, service_credit: 'continue' })
      )
    );
    await waitFor(() => expect(getUserWithRoles.mock.calls.length).toBeGreaterThan(fetchesBefore));
  });

  it('shows a members-manager the service history, with prior service noted', async () => {
    grantedPermissions = ['members.manage'];
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByRole('heading', { name: 'Service History' })).toBeInTheDocument();
    expect(await screen.findByText('Prior service (not counted)')).toBeInTheDocument();
    expect(screen.getByText('Dropped (voluntary)')).toBeInTheDocument();
    expect(screen.getByText('Not counted')).toBeInTheDocument();
    expect(getServiceHistory).toHaveBeenCalledWith(TARGET_ID);
    expect(screen.getByRole('button', { name: 'Edit service history' })).toBeInTheDocument();
  });

  it('keeps the service history from a colleague, since it records how a member left', async () => {
    renderWithRouter(<MemberProfilePage />);

    await screen.findByText('Captain · Life member');
    expect(screen.queryByRole('heading', { name: 'Service History' })).not.toBeInTheDocument();
    expect(getServiceHistory).not.toHaveBeenCalled();
  });

  it('lets a member read their own service history but not edit it', async () => {
    routeUserId = VIEWER_ID;
    getUserWithRoles.mockResolvedValue({ ...redactedColleague, id: VIEWER_ID });
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByRole('heading', { name: 'Service History' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit service history' })).not.toBeInTheDocument();
  });

  it('asks how earlier service counts when a retired member is brought back', async () => {
    const user = userEvent.setup();
    grantedPermissions = ['members.manage'];
    getUserWithRoles.mockResolvedValue({ ...redactedColleague, status: UserStatus.RETIRED });
    renderWithRouter(<MemberProfilePage />);

    await user.click(await screen.findByTitle('Change member status'));
    // Staying out of membership opens no stint, so nothing is asked.
    expect(screen.queryByRole('group', { name: /Earlier service/ })).not.toBeInTheDocument();

    await user.selectOptions(await screen.findByRole('combobox'), UserStatus.ACTIVE);
    await screen.findByRole('group', { name: /Earlier service/ });
    await user.click(screen.getByRole('radio', { name: /Restart at zero/ }));
    await user.click(screen.getByRole('button', { name: 'Update Status' }));

    await waitFor(() =>
      expect(changeStatus).toHaveBeenCalledWith(
        TARGET_ID,
        expect.objectContaining({ new_status: UserStatus.ACTIVE, service_credit: 'restart' })
      )
    );
  });

  it('sends no service choice for a change within membership', async () => {
    const user = userEvent.setup();
    grantedPermissions = ['members.manage'];
    renderWithRouter(<MemberProfilePage />);

    await user.click(await screen.findByTitle('Change member status'));
    await user.selectOptions(await screen.findByRole('combobox'), UserStatus.LEAVE);
    await user.click(screen.getByRole('button', { name: 'Update Status' }));

    await waitFor(() =>
      expect(changeStatus).toHaveBeenCalledWith(TARGET_ID, { new_status: UserStatus.LEAVE, reason: undefined })
    );
  });

  it('does not claim "no address on file" when only the personal email was shared', async () => {
    getUserWithRoles.mockResolvedValue({ ...redactedColleague, personal_email: 'jane@example.org' });
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText('jane@example.org')).toBeInTheDocument();
    expect(screen.queryByText('Address')).not.toBeInTheDocument();
    expect(screen.queryByText('No address on file.')).not.toBeInTheDocument();
  });

  it('tells a members-manager when the department, not the member, has a field off', async () => {
    grantedPermissions = ['members.manage'];
    checkContactInfoEnabled.mockResolvedValue({
      enabled: true,
      show_email: false,
      show_phone: true,
      show_mobile: true,
    });
    getUserWithRoles.mockResolvedValue({
      ...redactedColleague,
      email: 'jdoe@example.com',
      phone: '555-0100',
      profile_visibility: { ...shareNothing, email: true, phone: true },
    });
    renderWithRouter(<MemberProfilePage />);

    expect(await screen.findByText('Off for everyone (department setting)')).toBeInTheDocument();
    // Phone is allowed by both, so it still reads as visible.
    expect(screen.getByText('Visible to members')).toBeInTheDocument();
  });

  it('does not reserve a left column for an ID-card panel the integration hides', async () => {
    grantedPermissions = ['members.manage_id_cards'];
    nfcIdCardsConnected = false;
    renderWithRouter(<MemberProfilePage />);

    await screen.findByRole('heading', { name: 'jdoe' });
    expect(screen.getByTestId('profile-grid-two')).toBeInTheDocument();

    nfcIdCardsConnected = true;
    renderWithRouter(<MemberProfilePage />);
    expect(await screen.findByTestId('profile-grid-three')).toBeInTheDocument();
  });
});
