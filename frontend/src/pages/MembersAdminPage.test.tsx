import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { roleService, userService } from '../services/api';

vi.mock('../services/api', () => ({
  userService: {
    getUsersWithRoles: vi.fn(),
    assignUserRoles: vi.fn(),
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

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({ rankOptions: [] }),
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
