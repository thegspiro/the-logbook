/**
 * Role Management Page
 *
 * Administrative page for creating and managing custom roles and their permissions.
 */

import React, { useEffect, useState } from 'react';
import { roleService } from '../services/api';
import type { Role, PermissionCategory } from '../types/role';
import { getErrorMessage } from '../utils/errorHandling';

export const RoleManagementPage: React.FC = () => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<PermissionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
    permissions: [] as string[],
    priority: 50,
  });

  useEffect(() => {
    fetchData();
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
      setError('Unable to load roles and permissions. Please check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setFormData({
      name: '',
      slug: '',
      description: '',
      permissions: [],
      priority: 50,
    });
    setEditingRole(null);
    setShowCreateModal(true);
  };

  const handleEdit = (role: Role) => {
    setFormData({
      name: role.name,
      slug: role.slug,
      description: role.description || '',
      permissions: role.permissions,
      priority: role.priority,
    });
    setEditingRole(role);
    setShowCreateModal(true);
  };

  const handleSubmit = async () => {
    try {
      setError(null);

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
      setError(getErrorMessage(err, 'Unable to save the role. Please check your input and try again.'));
    }
  };

  const handleDelete = async (role: Role) => {
    if (!confirm(`Are you sure you want to delete the role "${role.name}"?`)) {
      return;
    }

    try {
      setError(null);
      await roleService.deleteRole(role.id);
      await fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to delete the role. It may still be assigned to users.'));
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="text-theme-text-muted" role="status" aria-live="polite">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-theme-text-primary">Role Management</h2>
            <p className="mt-1 text-sm text-theme-text-muted">
              Create and manage custom roles and permissions
            </p>
          </div>
          <button
            onClick={handleCreate}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Create Custom Role
          </button>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="bg-theme-surface backdrop-blur-sm shadow overflow-hidden sm:rounded-lg">
          <ul className="divide-y divide-white/10">
            {roles.map((role) => (
              <li key={role.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-medium text-theme-text-primary">{role.name}</h3>
                      {role.is_system && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          System Role
                        </span>
                      )}
                      <span className="text-sm text-theme-text-muted">Priority: {role.priority}</span>
                    </div>
                    {role.description && (
                      <p className="mt-1 text-sm text-theme-text-muted">{role.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {role.permissions.slice(0, 5).map((perm) => (
                        <span
                          key={perm}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-theme-surface text-theme-text-secondary"
                        >
                          {perm.split('.').pop()}
                        </span>
                      ))}
                      {role.permissions.length > 5 && (
                        <span className="text-xs text-theme-text-muted">
                          +{role.permissions.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(role)}
                      className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                    >
                      Edit
                    </button>
                    {!role.is_system && (
                      <button
                        onClick={() => handleDelete(role)}
                        className="text-red-400 hover:text-red-300 text-sm font-medium"
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
            className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-modal-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
          >
            <div className="bg-theme-surface rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="px-6 py-4 border-b border-theme-surface-border">
                <h3 id="role-modal-title" className="text-lg font-medium text-theme-text-primary">
                  {editingRole ? `Edit Role: ${editingRole.name}` : 'Create New Role'}
                </h3>
              </div>

              <div className="px-6 py-4 space-y-4">
                {editingRole?.is_system && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800">
                      System roles can only have their permissions modified.
                      Name and priority cannot be changed.
                    </p>
                  </div>
                )}

                <div>
                  <label htmlFor="role-name" className="block text-sm font-medium text-theme-text-secondary">Role Name</label>
                  <input
                    id="role-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    disabled={editingRole?.is_system}
                    required
                    aria-required="true"
                    className="mt-1 block w-full rounded-md border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-slate-700"
                  />
                </div>

                {!editingRole && (
                  <div>
                    <label htmlFor="role-slug" className="block text-sm font-medium text-theme-text-secondary">Slug</label>
                    <input
                      id="role-slug"
                      type="text"
                      value={formData.slug}
                      onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                      className="mt-1 block w-full rounded-md border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder="custom_role"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="role-description" className="block text-sm font-medium text-theme-text-secondary">Description</label>
                  <textarea
                    id="role-description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="mt-1 block w-full rounded-md border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                </div>

                {!editingRole?.is_system && (
                  <div>
                    <label htmlFor="role-priority" className="block text-sm font-medium text-theme-text-secondary">Priority (0-100)</label>
                    <input
                      id="role-priority"
                      type="number"
                      min="0"
                      max="100"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                      className="mt-1 block w-32 rounded-md border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    />
                    <p className="mt-1 text-xs text-theme-text-muted">Higher priority roles have more authority</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-3">Permissions</label>
                  <div className="space-y-4">
                    {permissionCategories.map((category) => {
                      const categoryPermissions = category.permissions.map((p) => p.name);
                      const allSelected = categoryPermissions.every((p) => formData.permissions.includes(p));
                      const someSelected = categoryPermissions.some((p) => formData.permissions.includes(p));

                      return (
                        <div key={category.category} className="border border-theme-surface-border rounded-lg p-4">
                          <label className="flex items-center mb-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(input) => {
                                if (input) input.indeterminate = someSelected && !allSelected;
                              }}
                              onChange={() => handleToggleCategory(category)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
                            />
                            <span className="ml-2 text-sm font-medium text-theme-text-primary uppercase">
                              {category.category.replace(/_/g, ' ')}
                            </span>
                          </label>
                          <div className="ml-6 space-y-1">
                            {category.permissions.map((perm) => (
                              <label key={perm.name} className="flex items-start cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formData.permissions.includes(perm.name)}
                                  onChange={() => handleTogglePermission(perm.name)}
                                  className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
                                />
                                <div className="ml-2">
                                  <div className="text-sm text-theme-text-primary">{perm.name}</div>
                                  <div className="text-xs text-theme-text-muted">{perm.description}</div>
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

              <div className="px-6 py-4 border-t border-theme-surface-border flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
                >
                  {editingRole ? 'Save Changes' : 'Create Role'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoleManagementPage;
