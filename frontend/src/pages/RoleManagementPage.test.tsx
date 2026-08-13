import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
});
