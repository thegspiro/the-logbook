/**
 * Role Management Page
 *
 * Administrative page for creating and managing custom roles and their permissions.
 */

import React, { useEffect, useState } from 'react';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { DialogPanel } from '../components/ux/DialogPanel';
import { roleService } from '../services/api';
import type { Role, PermissionCategory } from '../types/role';
import { getErrorMessage } from '../utils/errorHandling';
import { useConfirm } from '../contexts/ConfirmContext';
import { useFocusTrap } from '../hooks/useFocusTrap';

export const RoleManagementPage: React.FC = () => {
  const { confirm } = useConfirm();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<PermissionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { busy, run } = useSubmitGuard();
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const roleModalRef = useFocusTrap<HTMLDivElement>(showCreateModal);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissions: [] as string[],
    priority: 50,
  });

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [rolesData, permsData] = await Promise.all([
        roleService.getRoles(),
        roleService.getPermissionsByCategory(),
      ]);

      setRoles(rolesData);
      setPermissionCategories(permsData);
    } catch (_err) {
      setError('Could not load roles and permissions. Check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setFormData({
      name: '',
      description: '',
      permissions: [],
      priority: 50,
    });
    setEditingRole(null);
    setError(null);
    setShowCreateModal(true);
  };

  const handleEdit = (role: Role) => {
    setFormData({
      name: role.name,
      description: role.description || '',
      permissions: role.permissions,
      priority: role.priority,
    });
    setEditingRole(role);
    setError(null);
    setShowCreateModal(true);
  };

  const handleSubmit = () =>
    run(async () => {
      try {
        setError(null);
        // Checked here so the reason is ours rather than the server's
        // "name: Value is too short" (workflow review W05).
        if (!formData.name.trim()) {
          setError('Give the role a name.');
          return;
        }

        if (editingRole) {
          // Update existing role
          await roleService.updateRole(editingRole.id, {
            name: formData.name !== editingRole.name ? formData.name : undefined,
            description: formData.description !== editingRole.description ? formData.description : undefined,
            permissions: formData.permissions,
            priority: formData.priority !== editingRole.priority ? formData.priority : undefined,
          });
        } else {
          // Create new role
          await roleService.createRole(formData);
        }

        await fetchData();
        setShowCreateModal(false);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Could not save the role. Check the details and try again.'));
      }
    });

  const handleDelete = async (role: Role) => {
    if (
      !(await confirm({
        title: 'Delete role',
        message: `Delete the role "${role.name}"? Members assigned to it will lose its permissions.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }

    try {
      setError(null);
      await roleService.deleteRole(role.id);
      await fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not delete the role. Try again.'));
    }
  };

  const handleTogglePermission = (permission: string) => {
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const handleToggleCategory = (category: PermissionCategory) => {
    const categoryPermissions = category.permissions.map((p) => p.name);
    const allSelected = categoryPermissions.every((p) => formData.permissions.includes(p));

    setFormData((prev) => ({
      ...prev,
      permissions: allSelected
        ? prev.permissions.filter((p) => !categoryPermissions.includes(p))
        : [...new Set([...prev.permissions, ...categoryPermissions])],
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex h-64 items-center justify-center">
            <div className="text-theme-text-muted" role="status" aria-live="polite">
              Loading...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-theme-text-primary text-2xl font-bold">Role Management</h2>
            <p className="text-theme-text-muted mt-1 text-sm">Create custom roles and choose what each role can do</p>
          </div>
          <button
            onClick={handleCreate}
            className="btn-info inline-flex shrink-0 items-center self-start rounded-md text-sm font-medium sm:self-auto"
          >
            Create Custom Role
          </button>
        </div>

        {/* While the dialog is open its own copy of the error is the one the
            user can see; this one would sit behind the overlay. */}
        {error && !showCreateModal && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10"
          >
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="bg-theme-surface overflow-hidden shadow-sm backdrop-blur-xs sm:rounded-lg">
          <ul className="divide-theme-surface-border divide-y">
            {roles.map((role) => (
              <li key={role.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-theme-text-primary text-lg font-medium">{role.name}</h3>
                      {role.is_system && (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                          System Role
                        </span>
                      )}
                      <span className="text-theme-text-muted text-sm">Priority: {role.priority}</span>
                    </div>
                    {role.description && <p className="text-theme-text-muted mt-1 text-sm">{role.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {role.permissions.slice(0, 5).map((perm) => (
                        <span
                          key={perm}
                          className="bg-theme-surface text-theme-text-secondary inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium"
                        >
                          {perm}
                        </span>
                      ))}
                      {role.permissions.length > 5 && (
                        <span className="text-theme-text-muted text-xs">+{role.permissions.length - 5} more</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(role)}
                      className="touch-target-phone text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Edit
                    </button>
                    {!role.is_system && (
                      <button
                        onClick={() => {
                          void handleDelete(role);
                        }}
                        className="touch-target-phone text-sm font-medium text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Create/Edit Role Modal */}
        {showCreateModal && (
          <div
            ref={roleModalRef}
            className="modal-overlay z-50 flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-modal-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowCreateModal(false);
            }}
          >
            <DialogPanel
              onClose={() => setShowCreateModal(false)}
              className="mx-4 flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden"
            >
              <div className="border-theme-surface-border shrink-0 border-b px-6 py-4">
                <h3 id="role-modal-title" className="text-theme-text-primary text-lg font-medium">
                  {editingRole ? `Edit Role: ${editingRole.name}` : 'Create New Role'}
                </h3>
              </div>

              <div
                className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4"
                data-testid="role-modal-scroll-area"
              >
                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10"
                  >
                    <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                  </div>
                )}

                {editingRole?.is_system && (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-500/30 dark:bg-yellow-500/10">
                    <p className="text-sm text-yellow-800 dark:text-yellow-400">
                      {editingRole.slug === 'member'
                        ? 'This is the regular-member system role. Its display name may be customized; the internal “member” slug remains unchanged.'
                        : 'This is a system role. Only the description and permissions can be modified.'}
                    </p>
                  </div>
                )}

                <div>
                  <label htmlFor="role-name" className="text-theme-text-secondary block text-sm font-medium">
                    Role Name
                  </label>
                  <input
                    id="role-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    disabled={editingRole?.is_system && editingRole.slug !== 'member'}
                    required
                    aria-required="true"
                    className="form-input mt-1"
                  />
                </div>

                <div>
                  <label htmlFor="role-description" className="text-theme-text-secondary block text-sm font-medium">
                    Description
                  </label>
                  <textarea
                    id="role-description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="form-input mt-1"
                  />
                </div>

                {!editingRole?.is_system && (
                  <div>
                    <label htmlFor="role-priority" className="text-theme-text-secondary block text-sm font-medium">
                      Priority (0-100)
                    </label>
                    <input
                      id="role-priority"
                      type="number"
                      min="0"
                      max="100"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                      className="form-input mt-1 w-32"
                    />
                    {/* Priority orders lists and picks a member's main position
                        (label_service, inventory_service); no permission check
                        reads it, so it must not be described as authority
                        (workflow review W05). */}
                    <p className="text-theme-text-muted mt-1 text-xs">
                      Sets the order roles are listed in, and which of a member&apos;s roles counts as their main one.
                      It grants no permissions.
                    </p>
                  </div>
                )}

                <div>
                  <label className="text-theme-text-secondary mb-3 block text-sm font-medium">Permissions</label>
                  <div className="space-y-4">
                    {permissionCategories.map((category) => {
                      const categoryPermissions = category.permissions.map((p) => p.name);
                      const allSelected = categoryPermissions.every((p) => formData.permissions.includes(p));
                      const someSelected = categoryPermissions.some((p) => formData.permissions.includes(p));

                      return (
                        <div key={category.category} className="border-theme-surface-border rounded-lg border p-4">
                          <label className="mb-2 flex cursor-pointer items-center">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(input) => {
                                if (input) input.indeterminate = someSelected && !allSelected;
                              }}
                              onChange={() => handleToggleCategory(category)}
                              className="form-checkbox border-theme-surface-border"
                            />
                            <span className="text-theme-text-primary ml-2 text-sm font-medium uppercase">
                              {category.category.replace(/_/g, ' ')}
                            </span>
                          </label>
                          <div className="ml-6 space-y-1">
                            {category.permissions.map((perm) => (
                              <label key={perm.name} className="flex cursor-pointer items-start">
                                <input
                                  type="checkbox"
                                  checked={formData.permissions.includes(perm.name)}
                                  onChange={() => handleTogglePermission(perm.name)}
                                  className="form-checkbox border-theme-surface-border mt-0.5"
                                />
                                <div className="ml-2">
                                  <div className="text-theme-text-primary text-sm">{perm.name}</div>
                                  <div className="text-theme-text-muted text-xs">{perm.description}</div>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div
                className="bg-theme-surface-modal border-theme-surface-border flex shrink-0 justify-end gap-3 border-t px-6 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
                data-testid="role-modal-actions"
              >
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary text-theme-text-secondary text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    void handleSubmit();
                  }}
                  className="btn-info rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editingRole ? 'Save Changes' : 'Create Role'}
                </button>
              </div>
            </DialogPanel>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoleManagementPage;
