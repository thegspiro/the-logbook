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
  },
  roleService: {
    getRoles: vi.fn(),
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
  useRanks: () => ({ rankOptions: [] }),
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

describe('MembersAdminPage — Manage Roles refusals (workflow review W05)', () => {
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

    await user.click(await screen.findByRole('button', { name: 'Manage Roles' }));
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

    await user.click(await screen.findByRole('button', { name: 'Reset Password' }));
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

    await user.click(await screen.findByRole('button', { name: 'Reset Password' }));
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

    await user.click(await screen.findByRole('button', { name: /view by role/i }));
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

    await user.click(await screen.findByRole('button', { name: 'Remove Chief role from Jordan Avery' }));
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
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(userService.adminUnlockAccount).toHaveBeenCalledWith('user-1');
    await vi.waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Jordan Avery can sign in again'));
    await vi.waitFor(() => expect(screen.queryByText(/Sign-in locked until/)).not.toBeInTheDocument());
  });

  it('offers no Unlock for an account that is not locked', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    renderWithRouter(<MembersAdminPage />);

    expect(await screen.findByRole('button', { name: 'Reset Password' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();
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

    expect(await screen.findByRole('button', { name: 'Remove Driver role from Jordan Avery' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Member role from Jordan Avery' })).not.toBeInTheDocument();
  });

  it('keeps the Member box ticked and locked in Manage Roles', async () => {
    const user = userEvent.setup();
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([member] as never);
    renderWithRouter(<MembersAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'Manage Roles' }));
    const dialog = screen.getByRole('dialog');
    const box = within(dialog).getByRole('checkbox', { name: /Member/ });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /Driver/ })).toBeEnabled();
  });

  it('still offers removal from an archived member', async () => {
    vi.mocked(userService.getUsersWithRoles).mockResolvedValue([{ ...member, status: 'archived' }] as never);
    renderWithRouter(<MembersAdminPage />);

    expect(await screen.findByRole('button', { name: 'Remove Member role from Jordan Avery' })).toBeInTheDocument();
  });
});
