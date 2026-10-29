import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { roleService, userService } from '../services/api';

vi.mock('../services/api', () => ({
  userService: {
    getUsersWithRoles: vi.fn(),
    assignUserRoles: vi.fn(),
    adminResetPassword: vi.fn(),
    adminUnlockAccount: vi.fn(),
    adminListPasskeys: vi.fn(),
    adminRemovePasskey: vi.fn(),
  },
  roleService: {
    getRoles: vi.fn(),
  },
  memberStatusService: {
    getOverduePropertyReturns: () => Promise.resolve({ overdue_count: 0, members: [] }),
  },
  locationsService: {
    getLocations: vi.fn(),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: () => true,
    user: { id: 'coordinator-1' },
  }),
}));

const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => mockToastSuccess(...args) as unknown, error: vi.fn() },
}));

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    rankOptions: [{ value: 'firefighter', label: 'Firefighter' }],
    formatRank: (code: string | null | undefined) => (code === 'firefighter' ? 'Firefighter' : (code ?? '')),
  }),
}));

// The auth-store mock above ignores selectors, which is what useTimezone reads.
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'UTC',
}));

import { locationsService } from '../services/api';
import MembersAdminPage from './MembersAdminPage';

const memberRole = {
  id: 'role-member',
  organization_id: 'org-1',
  name: 'Member',
  slug: 'member',
  description: 'Regular department member',
  permissions: ['events.view'],
  is_system: true,
  priority: 10,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const chiefRole = {
  ...memberRole,
  id: 'role-chief',
  name: 'Chief',
  slug: 'fire_chief',
  description: 'Highest-ranking officer',
  permissions: ['*'],
  priority: 95,
};

const member = {
  id: 'user-1',
  organization_id: 'org-1',
  username: 'review_member',
  first_name: 'Jordan',
  last_name: 'Avery',
  full_name: 'Jordan Avery',
  email: 'member@example.org',
  status: 'active',
  roles: [memberRole],
};

describe('MembersAdminPage — the roster names rank, membership type and positions apart', () => {
  beforeEach(() => {
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
  });

  // A probationary member with no office showed one chip, "Member", and
  // nothing else: rank and membership type were not on the roster at all, so
  // "Roles" read as the place probation should appear and never did.
  it('shows rank and membership type beside the positions', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      {
        ...member,
        rank: 'firefighter',
        membership_type: 'probationary',
        member_class: 'operational',
        member_status: 'probationary',
      },
    ] as never);
    renderWithRouter(<MembersAdminPage />);

    const row = await screen.findByRole('row', { name: /Jordan Avery/ });
    expect(within(row).getByText('Firefighter')).toBeInTheDocument();
    // Class and status are two facts, shown as one cell.
    expect(within(row).getByText('Operational · Probationary member')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Positions' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Membership' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Roles' })).not.toBeInTheDocument();
  });

  it('marks a committee apart from an office on the roster chips', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      {
        ...member,
        roles: [
          { ...memberRole, id: 'r-treasurer', name: 'Treasurer', slug: 'treasurer', kind: 'office' },
          { ...memberRole, id: 'r-history', name: 'History Committee', slug: 'history_committee', kind: 'committee' },
        ],
      },
    ] as never);
    renderWithRouter(<MembersAdminPage />);

    const row = await screen.findByRole('row', { name: /Jordan Avery/ });
    // The chip is the element whose own text is the name.
    expect(within(row).getByText('Treasurer')).toHaveAttribute('data-kind', 'office');
    expect(within(row).getByText('History Committee')).toHaveAttribute('data-kind', 'committee');
  });
});

describe('MembersAdminPage — Manage Positions refusals (workflow review W05)', () => {
  beforeEach(() => {
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole, chiefRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.assignUserRoles).mockReset();
  });

  // A coordinator may assign positions, just not one that carries more than
  // they hold. The page replaced the server's reason with "You do not have
  // permission to assign roles" and rendered it behind the dialog, so the
  // save looked like it did nothing.
  it("shows the server's reason for a refused position inside the dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(userService.assignUserRoles).mockRejectedValueOnce({
      response: {
        status: 403,
        data: { detail: 'You cannot assign a role that grants permissions beyond your own.' },
      },
    });
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Manage positions for Jordan Avery' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: /Chief/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You cannot assign a role that grants permissions beyond your own.'
    );
    expect(screen.getAllByText(/beyond your own/)).toHaveLength(1);
    expect(userService.assignUserRoles).toHaveBeenCalledWith('user-1', ['role-member', 'role-chief']);
  });
});

describe('MembersAdminPage — Reset Password (workflow review W11)', () => {
  beforeEach(() => {
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.adminResetPassword).mockReset();
    vi.mocked(userService.adminResetPassword).mockResolvedValue({ message: 'ok' });
    mockToastSuccess.mockReset();
  });

  // The refusal said only "does not meet strength requirements", with no word
  // on which rule, and the two fields had no accessible name.
  it('lists the rules a refused password breaks, and sends nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Reset password for Jordan Avery' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('New Password'), 'Abcdefgh1234!');
    await user.type(within(dialog).getByLabelText('Confirm Password'), 'Abcdefgh1234!');
    await user.click(within(dialog).getByRole('button', { name: 'Reset Password' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Password does not meet every rule listed below'
    );
    expect(within(dialog).getByRole('list', { name: 'Password rules' })).toHaveTextContent(/○ No runs like 123 or abc/);
    expect(userService.adminResetPassword).not.toHaveBeenCalled();
  });

  // Success closed the dialog and said nothing, which reads the same as a
  // dismissed dialog.
  it('confirms a reset that went through', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Reset password for Jordan Avery' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('New Password'), 'Tanker$Maple947');
    await user.type(within(dialog).getByLabelText('Confirm Password'), 'Tanker$Maple947');
    await user.click(within(dialog).getByRole('button', { name: 'Reset Password' }));

    await vi.waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Password reset for Jordan Avery'));
    expect(userService.adminResetPassword).toHaveBeenCalledWith('user-1', 'Tanker$Maple947', true);
  });
});

describe('MembersAdminPage — Manage Members for a position (workflow review W11)', () => {
  const member2 = {
    ...member,
    id: 'user-2',
    username: 'review_member2',
    first_name: 'Imogen',
    last_name: 'One',
    full_name: 'Imogen One',
    roles: [],
  };
  const member3 = {
    ...member,
    id: 'user-3',
    username: 'review_member3',
    first_name: 'Ian',
    last_name: 'Two',
    full_name: 'Ian Two',
    roles: [],
  };

  beforeEach(() => {
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member, member2, member3] as never);
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole, chiefRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.assignUserRoles).mockReset();
  });

  // Under `Promise.all`, one refusal rejected the save while the other
  // request still landed; the page showed only the refusal, did not reload,
  // and did not say that anything had been saved.
  it('saves one member at a time, reloads, and names the one that was refused', async () => {
    const user = userEvent.setup();
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(userService.assignUserRoles).mockImplementation(async (userId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (userId === 'user-3') {
        throw Object.assign(new Error('refused'), {
          response: { status: 400, data: { detail: 'Member is archived.' } },
        });
      }
      return {} as never;
    });
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: /view by position/i }));
    const chiefCard = (await screen.findAllByRole('button', { name: 'Manage Members' }))[1] ?? document.body;
    await user.click(chiefCard);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: /Imogen One/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Ian Two/ }));
    const loadsBefore = vi.mocked(userService.getUsersWithRoles).mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '1 of 2 changes saved. Not saved — Ian Two: Member is archived.'
    );
    expect(maxInFlight).toBe(1);
    expect(userService.assignUserRoles).toHaveBeenCalledWith('user-2', ['role-chief']);
    expect(vi.mocked(userService.getUsersWithRoles).mock.calls.length).toBeGreaterThan(loadsBefore);
  });
});

describe('MembersAdminPage — quick-removing a position (workflow review W11)', () => {
  beforeEach(() => {
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.assignUserRoles).mockReset();
  });

  // The confirmation read "Remove this role from Jordan Avery?", and a refusal
  // — such as the last administrator's — was reported as a connection fault.
  it("names the position, and shows the server's reason for a refusal", async () => {
    const user = userEvent.setup();
    vi.mocked(userService.assignUserRoles).mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'Cannot remove the only remaining administrator.' } },
    });
    // The Chief position, not Member: Member carries no remove control on a
    // current member (W11-9).
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      { ...member, roles: [memberRole, chiefRole] },
    ] as never);
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Remove Chief position from Jordan Avery' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Remove Chief from Jordan Avery?');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Cannot remove the only remaining administrator.')).toBeInTheDocument();
    expect(screen.queryByText(/check your connection/)).not.toBeInTheDocument();
  });
});

describe('MembersAdminPage — sign-in lockout (workflow review W02-4)', () => {
  const locked = { ...member, locked_until: '2027-03-01T18:15:00Z' };

  beforeEach(() => {
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([locked] as never);
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.adminUnlockAccount).mockReset();
    vi.mocked(userService.adminUnlockAccount).mockResolvedValue({ message: 'ok' });
    mockToastSuccess.mockReset();
  });

  // A locked account answered the correct password with "Incorrect username
  // or password", and the administrator the member called saw nothing wrong.
  it('shows the lock and lifts it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MembersAdminPage />);

    expect(await screen.findByText(/Sign-in locked until 6:15/)).toBeInTheDocument();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    await user.click(screen.getByRole('button', { name: 'Unlock Jordan Avery' }));

    expect(userService.adminUnlockAccount).toHaveBeenCalledWith('user-1');
    await vi.waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Jordan Avery can sign in again'));
    await vi.waitFor(() => expect(screen.queryByText(/Sign-in locked until/)).not.toBeInTheDocument());
  });

  it('offers no Unlock for an account that is not locked', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    renderWithRouter(<MembersAdminPage />);

    expect(await screen.findByRole('button', { name: 'Reset password for Jordan Avery' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Unlock/ })).not.toBeInTheDocument();
  });
});

// W11-9: the server refuses to remove the base Member position from anyone
// still a member, so the screen does not offer it.
describe('MembersAdminPage — the base Member position (workflow review W11-9)', () => {
  const driverRole = { ...memberRole, id: 'role-driver', name: 'Driver', slug: 'driver', is_system: false };

  beforeEach(() => {
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole, driverRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(userService.assignUserRoles).mockReset();
  });

  it('offers no remove control for an active member, but does for other positions', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      { ...member, roles: [memberRole, driverRole] },
    ] as never);
    renderWithRouter(<MembersAdminPage />);

    expect(await screen.findByRole('button', { name: 'Remove Driver position from Jordan Avery' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Member position from Jordan Avery' })).not.toBeInTheDocument();
  });

  it('keeps the Member box ticked and locked in Manage Positions', async () => {
    const user = userEvent.setup();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Manage positions for Jordan Avery' }));
    const dialog = screen.getByRole('dialog');
    const box = within(dialog).getByRole('checkbox', { name: /Member/ });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /Driver/ })).toBeEnabled();
  });

  it('still offers removal from an archived member', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([{ ...member, status: 'archived' }] as never);
    renderWithRouter(<MembersAdminPage />);

    expect(await screen.findByRole('button', { name: 'Remove Member position from Jordan Avery' })).toBeInTheDocument();
  });
});

describe('MembersAdminPage — positions that mirror a rank', () => {
  // The seeded Firefighter *position* beside the Firefighter *rank*: the
  // same word in two columns, and offered in two pickers.
  const firefighterRole = {
    ...memberRole,
    id: 'role-firefighter',
    name: 'Firefighter',
    slug: 'firefighter',
    description: 'Standard operational access',
    priority: 15,
    mirrors_rank: true,
  };
  const driverRole = { ...memberRole, id: 'role-driver', name: 'Driver', slug: 'driver', is_system: false };

  beforeEach(() => {
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole, firefighterRole, driverRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(userService.assignUserRoles).mockReset();
    vi.mocked(userService.assignUserRoles).mockResolvedValue({} as never);
  });

  it('keeps the mirror off the roster chips, so the word appears once, as a rank', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      { ...member, rank: 'firefighter', roles: [memberRole, firefighterRole] },
    ] as never);
    renderWithRouter(<MembersAdminPage />);

    const row = await screen.findByRole('row', { name: /Jordan Avery/ });
    expect(within(row).getAllByText('Firefighter')).toHaveLength(1);
    expect(within(row).getByText('Member')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove Firefighter position/ })).not.toBeInTheDocument();
  });

  it('reads "No positions" when the mirror is all a member holds', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([{ ...member, roles: [firefighterRole] }] as never);
    renderWithRouter(<MembersAdminPage />);

    const row = await screen.findByRole('row', { name: /Jordan Avery/ });
    expect(within(row).getByText('No positions')).toBeInTheDocument();
  });

  it('does not offer the mirror in Manage Positions to a member who lacks it', async () => {
    const user = userEvent.setup();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Manage positions for Jordan Avery' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: /Driver/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: /Firefighter/ })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('A rank is set from the member’s profile, not here.');
  });

  it('lists a held mirror as a rank so it can be taken off, and keeps it when it is not', async () => {
    const user = userEvent.setup();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      { ...member, roles: [memberRole, firefighterRole] },
    ] as never);
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Manage positions for Jordan Avery' }));
    const dialog = screen.getByRole('dialog');
    const box = within(dialog).getByRole('checkbox', { name: /Firefighter/ });
    expect(box).toBeChecked();
    expect(dialog).toHaveTextContent('Duplicates the Firefighter rank');

    // Adding Driver leaves the held mirror exactly as it was.
    await user.click(within(dialog).getByRole('checkbox', { name: /Driver/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    expect(userService.assignUserRoles).toHaveBeenCalledWith('user-1', [
      'role-member',
      'role-firefighter',
      'role-driver',
    ]);
  });

  it('can take a held mirror off', async () => {
    const user = userEvent.setup();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      { ...member, roles: [memberRole, firefighterRole] },
    ] as never);
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Manage positions for Jordan Avery' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: /Firefighter/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    expect(userService.assignUserRoles).toHaveBeenCalledWith('user-1', ['role-member']);
  });

  it('has no card for the mirror under View by Position', async () => {
    const user = userEvent.setup();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      { ...member, roles: [memberRole, firefighterRole] },
    ] as never);
    renderWithRouter(<MembersAdminPage />);

    await screen.findByRole('row', { name: /Jordan Avery/ });
    await user.click(screen.getByRole('button', { name: 'View by Position' }));
    expect(screen.getByRole('heading', { name: 'Driver' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Firefighter' })).not.toBeInTheDocument();
  });
});

// Members review A/C: the roster gave a coordinator no way from a row to the
// member's profile, and a screen reader heard "Edit, Manage Positions, Delete"
// repeated down the list with nothing saying whose.
describe('MembersAdminPage — reaching and naming a member (members review)', () => {
  beforeEach(() => {
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.getUsersWithRoles).mockReset();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      { ...member, roles: [memberRole], mfa_enabled: true, locked_until: '2027-03-01T18:15:00Z' },
    ] as never);
  });

  it("links the member's name to their profile", async () => {
    renderWithRouter(<MembersAdminPage />);

    expect(await screen.findByRole('link', { name: 'Jordan Avery' })).toHaveAttribute('href', '/members/user-1');
  });

  it('links the name from the by-position view too', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: /View by Position/ }));
    expect(screen.getByRole('link', { name: 'Jordan Avery' })).toHaveAttribute('href', '/members/user-1');
  });

  it('names every row action after the member it acts on', async () => {
    renderWithRouter(<MembersAdminPage />);

    for (const name of [
      'Edit Jordan Avery',
      'Manage positions for Jordan Avery',
      'Reset password for Jordan Avery',
      'Unlock Jordan Avery',
      'Reset MFA for Jordan Avery',
      'Delete Jordan Avery',
    ]) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe("MembersAdminPage — removing a lost phone's passkey", () => {
  const lostPhone = {
    id: 'pk-1',
    name: 'Lost phone',
    created_at: '2026-10-01T12:00:00Z',
    last_used_at: null,
    backed_up: true,
  };

  beforeEach(() => {
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole] as never);
    vi.mocked(locationsService.getLocations).mockReset();
    vi.mocked(locationsService.getLocations).mockResolvedValue([] as never);
    vi.mocked(userService.getUsersWithRoles).mockReset();
    // Passkey only: no authenticator app, so mfa_enabled alone would have
    // hidden the action.
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([
      { ...member, roles: [memberRole], mfa_enabled: false, has_passkey: true },
    ] as never);
    vi.mocked(userService.adminListPasskeys).mockReset();
    vi.mocked(userService.adminListPasskeys).mockResolvedValue([lostPhone] as never);
    vi.mocked(userService.adminRemovePasskey).mockReset();
    vi.mocked(userService.adminRemovePasskey).mockResolvedValue({ message: 'Passkey removed' });
  });

  it('offers the two-factor action for a member whose only factor is a passkey', async () => {
    renderWithRouter(<MembersAdminPage />);
    expect(await screen.findByRole('button', { name: 'Reset MFA for Jordan Avery' })).toBeInTheDocument();
  });

  it('removes just the one passkey after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Reset MFA for Jordan Avery' }));
    expect(userService.adminListPasskeys).toHaveBeenCalledWith('user-1');
    await user.click(await screen.findByRole('button', { name: 'Remove passkey Lost phone' }));
    await user.click(await screen.findByRole('button', { name: 'Remove passkey' }));

    expect(userService.adminRemovePasskey).toHaveBeenCalledWith('user-1', 'pk-1');
    expect(await screen.findByText(/removes the member's authenticator, every passkey/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove passkey Lost phone' })).not.toBeInTheDocument();
  });
});
