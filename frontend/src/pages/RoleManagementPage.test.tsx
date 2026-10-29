import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { roleService } from '../services/api';
import { RoleManagementPage } from './RoleManagementPage';

vi.mock('../services/api', () => ({
  roleService: {
    getRoles: vi.fn(),
    getPermissionsByCategory: vi.fn(),
    updateRole: vi.fn(),
    createRole: vi.fn(),
    deleteRole: vi.fn(),
  },
}));

const role = {
  id: 'role-1',
  organization_id: 'org-1',
  name: 'Operations Officer',
  slug: 'operations-officer',
  description: 'Manages operations',
  permissions: ['events.view'],
  is_system: false,
  priority: 50,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const memberRole = {
  ...role,
  id: 'member-role',
  name: 'Member',
  slug: 'member',
  is_system: true,
  priority: 10,
};

const fixedSystemRole = {
  ...role,
  id: 'chief-role',
  name: 'Chief',
  slug: 'chief',
  is_system: true,
  priority: 90,
};

describe('RoleManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(roleService.getRoles).mockResolvedValue([role]);
    vi.mocked(roleService.getPermissionsByCategory).mockResolvedValue([
      {
        category: 'events',
        permissions: [{ name: 'events.view', description: 'View events', category: 'events' }],
      },
    ]);
  });

  it('keeps actions outside the independently scrollable role form', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RoleManagementPage />);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const scrollArea = screen.getByTestId('role-modal-scroll-area');
    const actions = screen.getByTestId('role-modal-actions');
    expect(scrollArea).toHaveClass('overflow-y-auto', 'overscroll-contain');
    expect(actions).toHaveClass('shrink-0');
    expect(scrollArea).not.toContainElement(screen.getByRole('button', { name: 'Cancel' }));
    expect(scrollArea).not.toContainElement(screen.getByRole('button', { name: 'Save Changes' }));
  });

  it('moves focus into the modal and returns it to the Edit trigger when closed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RoleManagementPage />);

    const editButton = await screen.findByRole('button', { name: 'Edit' });
    await user.click(editButton);

    await waitFor(() => expect(screen.getByLabelText('Role Name')).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(editButton).toHaveFocus();
  });

  it('edits the regular-member display name without submitting its slug', async () => {
    const user = userEvent.setup();
    vi.mocked(roleService.getRoles).mockResolvedValue([memberRole]);
    vi.mocked(roleService.updateRole).mockResolvedValue({ ...memberRole, name: 'Volunteer' });
    renderWithRouter(<RoleManagementPage />);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText('Role Name');
    expect(name).toBeEnabled();
    expect(screen.getByText(/display name may be customized/i)).toHaveTextContent(
      'internal “member” slug remains unchanged'
    );

    await user.clear(name);
    await user.type(name, 'Volunteer');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(roleService.updateRole).toHaveBeenCalledWith('member-role', expect.objectContaining({ name: 'Volunteer' }))
    );
    expect(vi.mocked(roleService.updateRole).mock.calls[0]?.[1]).not.toHaveProperty('slug');
  });

  it('keeps other system-position names fixed', async () => {
    const user = userEvent.setup();
    vi.mocked(roleService.getRoles).mockResolvedValue([fixedSystemRole]);
    renderWithRouter(<RoleManagementPage />);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Role Name')).toBeDisabled();
    expect(screen.getByText(/only the description and permissions/i)).toBeInTheDocument();
  });

  // W05-5: a new name may not repeat another position's, but pairs that already
  // did are left and marked so an administrator can tell them apart.
  it('marks positions that share a name, and only those', async () => {
    vi.mocked(roleService.getRoles).mockResolvedValue([
      { ...role, id: 'a', name: 'Report Reader', slug: 'report_reader' },
      { ...role, id: 'b', name: 'report reader ', slug: 'report_reader_2' },
      { ...role, id: 'c', name: 'Driver', slug: 'driver' },
    ]);
    renderWithRouter(<RoleManagementPage />);

    expect(await screen.findAllByText('Same name as another position')).toHaveLength(2);
    expect(screen.getByText('report_reader_2')).toBeInTheDocument();
    expect(screen.queryByText('driver')).not.toBeInTheDocument();
  });

  // ORU-7c: the member position is held by everyone, so changing its grants
  // asks first and names how many members it reaches.
  describe('changing the baseline member position', () => {
    const permissionCategories = [
      {
        category: 'events',
        permissions: [
          { name: 'events.view', description: 'View events', category: 'events' },
          { name: 'events.manage', description: 'Manage events', category: 'events' },
        ],
      },
    ];

    beforeEach(() => {
      vi.mocked(roleService.getRoles).mockReset();
      vi.mocked(roleService.getRoles).mockResolvedValue([{ ...memberRole, user_count: 42 }]);
      vi.mocked(roleService.getPermissionsByCategory).mockReset();
      vi.mocked(roleService.getPermissionsByCategory).mockResolvedValue(permissionCategories);
      vi.mocked(roleService.updateRole).mockReset();
      vi.mocked(roleService.updateRole).mockResolvedValue(memberRole);
    });

    it('names the member count before granting, and saves only on confirm', async () => {
      const user = userEvent.setup();
      renderWithRouter(<RoleManagementPage />);

      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      await user.click(screen.getByRole('checkbox', { name: /Manage events/ }));
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      const confirmDialog = await screen.findByRole('dialog', { name: /Change permissions for every member/ });
      expect(confirmDialog).toHaveTextContent('every member (42 members)');
      expect(confirmDialog).toHaveTextContent('grants events.manage');
      expect(roleService.updateRole).not.toHaveBeenCalled();

      await user.click(within(confirmDialog).getByRole('button', { name: 'Apply to 42 members' }));
      await waitFor(() =>
        expect(roleService.updateRole).toHaveBeenCalledWith(
          'member-role',
          expect.objectContaining({ permissions: ['events.view', 'events.manage'] })
        )
      );
    });

    it('does not save when the officer keeps editing', async () => {
      const user = userEvent.setup();
      renderWithRouter(<RoleManagementPage />);

      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      await user.click(screen.getByRole('checkbox', { name: /View events/ }));
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      const confirmDialog = await screen.findByRole('dialog', { name: /Change permissions for every member/ });
      expect(confirmDialog).toHaveTextContent('removes events.view');
      await user.click(within(confirmDialog).getByRole('button', { name: 'Keep editing' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: /Change permissions for every member/ })).not.toBeInTheDocument()
      );
      expect(roleService.updateRole).not.toHaveBeenCalled();
    });

    it('does not ask when the change is not a permission change', async () => {
      const user = userEvent.setup();
      renderWithRouter(<RoleManagementPage />);

      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      await user.type(screen.getByLabelText('Description'), ' updated');
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(roleService.updateRole).toHaveBeenCalled());
      expect(screen.queryByRole('dialog', { name: /Change permissions for every member/ })).not.toBeInTheDocument();
    });
  });

  // W05: the save error was rendered on the page behind the dialog, so a
  // refused save looked like a button that did nothing.
  describe('errors while the dialog is open', () => {
    it('refuses an empty name inside the dialog without calling the server', async () => {
      const user = userEvent.setup();
      renderWithRouter(<RoleManagementPage />);

      await user.click(await screen.findByRole('button', { name: 'Create Custom Role' }));
      await user.click(screen.getByRole('button', { name: 'Create Role' }));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the role a name.');
      expect(roleService.createRole).not.toHaveBeenCalled();
    });

    it('shows a refused save inside the dialog, once', async () => {
      const user = userEvent.setup();
      vi.mocked(roleService.createRole).mockRejectedValueOnce(
        new Error('You cannot grant a role permissions beyond your own (offending permission: *).')
      );
      renderWithRouter(<RoleManagementPage />);

      await user.click(await screen.findByRole('button', { name: 'Create Custom Role' }));
      await user.type(screen.getByLabelText('Role Name'), 'Report Reader');
      await user.click(screen.getByRole('button', { name: 'Create Role' }));

      const dialog = screen.getByRole('dialog');
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/beyond your own/);
      expect(screen.getAllByText(/beyond your own/)).toHaveLength(1);
    });
  });

  describe('the name sent', () => {
    beforeEach(() => {
      vi.mocked(roleService.createRole).mockReset();
      vi.mocked(roleService.createRole).mockResolvedValue({ ...role, id: 'role-2', name: 'Report Reader' });
      vi.mocked(roleService.updateRole).mockReset();
      vi.mocked(roleService.updateRole).mockResolvedValue(role);
    });

    it('trims the name of a new role', async () => {
      const user = userEvent.setup();
      renderWithRouter(<RoleManagementPage />);

      await user.click(await screen.findByRole('button', { name: 'Create Custom Role' }));
      await user.type(screen.getByLabelText('Role Name'), '  Report Reader  ');
      await user.click(screen.getByRole('button', { name: 'Create Role' }));

      await waitFor(() => expect(roleService.createRole).toHaveBeenCalledTimes(1));
      expect(roleService.createRole).toHaveBeenCalledWith(expect.objectContaining({ name: 'Report Reader' }));
    });

    it('creates an office by default, and a committee when asked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<RoleManagementPage />);

      await user.click(await screen.findByRole('button', { name: 'Create Custom Role' }));
      await user.type(screen.getByLabelText('Role Name'), 'Bingo Night Crew');
      expect(screen.getByRole('radio', { name: /^Office/ })).toBeChecked();
      await user.click(screen.getByRole('radio', { name: /^Committee/ }));
      await user.click(screen.getByRole('button', { name: 'Create Role' }));

      await waitFor(() => expect(roleService.createRole).toHaveBeenCalledTimes(1));
      expect(roleService.createRole).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bingo Night Crew', kind: 'committee' })
      );
    });

    it('does not resend an unchanged name that only gained surrounding spaces', async () => {
      const user = userEvent.setup();
      renderWithRouter(<RoleManagementPage />);

      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      await user.type(screen.getByLabelText('Role Name'), '  ');
      await user.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(roleService.updateRole).toHaveBeenCalledTimes(1));
      expect(vi.mocked(roleService.updateRole).mock.calls[0]?.[1]).toMatchObject({ name: undefined });
    });
  });

  it('does not describe priority as authority', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RoleManagementPage />);

    await user.click(await screen.findByRole('button', { name: 'Create Custom Role' }));

    expect(screen.getByText(/It grants no permissions/)).toBeInTheDocument();
    expect(screen.queryByText(/more authority/)).not.toBeInTheDocument();
  });

  it('shows each permission by its full name, not its last segment', async () => {
    renderWithRouter(<RoleManagementPage />);

    expect(await screen.findByText('events.view')).toBeInTheDocument();
  });
});

describe('RoleManagementPage deleting a role', () => {
  beforeEach(() => {
    vi.mocked(roleService.getRoles).mockReset();
    vi.mocked(roleService.getRoles).mockResolvedValue([{ ...role, user_count: 4 }]);
    vi.mocked(roleService.getPermissionsByCategory).mockReset();
    vi.mocked(roleService.getPermissionsByCategory).mockResolvedValue([]);
    vi.mocked(roleService.deleteRole).mockReset();
  });

  it('says how many members hold the role, and deletes nothing when kept', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RoleManagementPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('4 members hold it and will lose its permissions.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(roleService.deleteRole).not.toHaveBeenCalled();
  });
});

describe('RoleManagementPage — positions that mirror a rank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(roleService.getPermissionsByCategory).mockResolvedValue([]);
  });

  // The member screens leave these positions out, so this page — where their
  // stored grants are edited — is where an administrator learns why.
  it('marks the mirror, and only the mirror', async () => {
    vi.mocked(roleService.getRoles).mockResolvedValue([
      memberRole,
      { ...fixedSystemRole, id: 'captain-role', name: 'Captain', slug: 'captain', mirrors_rank: true },
    ]);
    renderWithRouter(<RoleManagementPage />);

    expect(await screen.findByText('Mirrors a rank')).toBeInTheDocument();
    expect(screen.getAllByText('Mirrors a rank')).toHaveLength(1);
    expect(screen.getByText(/Carries the Captain rank’s access/)).toBeInTheDocument();
  });
});
