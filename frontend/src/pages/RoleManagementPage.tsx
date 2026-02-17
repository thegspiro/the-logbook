/**
 * Role Management Page
 *
 * Administrative page for creating and managing custom roles and their permissions.
 * Two views: "Roles & Permissions" shows what each role can do,
 * "Role Assignments" shows which members hold each role.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Shield,
  Users,
  ChevronDown,
  ChevronRight,
  User,
  Mail,
  Loader2,
} from 'lucide-react';
import { roleService } from '../services/api';
import type { RoleWithUserCount, PermissionCategory, Permission, Role } from '../types/role';
import type { RoleUsersResponse, RoleUserItem } from '../types/role';
import { getErrorMessage } from '../utils/errorHandling';

type ViewTab = 'permissions' | 'members';

export const RoleManagementPage: React.FC = () => {
  const [roles, setRoles] = useState<RoleWithUserCount[]>([]);
  const [permissionCategories, setPermissionCategories] = useState<PermissionCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('permissions');
  const [expandedRoles, setExpandedRoles] = useState<string[]>([]);

  // Members tab state
  const [roleUsers, setRoleUsers] = useState<Record<string, RoleUsersResponse>>({});
  const [loadingUsers, setLoadingUsers] = useState<Record<string, boolean>>({});

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
    } catch {
      setError('Unable to load roles and permissions. Please check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  // Build a lookup: permission name → Permission object (with description/category)
  const permissionLookup: Record<string, Permission> = {};
  permissionCategories.forEach((cat) => {
    cat.permissions.forEach((p) => {
      permissionLookup[p.name] = p;
    });
  });

  // Group a role's permissions by category
  const groupPermissionsByCategory = (permissions: string[]) => {
    const grouped: Record<string, { category: string; permissions: Permission[] }> = {};
    permissions.forEach((permName) => {
      const perm = permissionLookup[permName];
      if (perm) {
        const cat = perm.category;
        if (!grouped[cat]) {
          grouped[cat] = { category: cat, permissions: [] };
        }
        grouped[cat].permissions.push(perm);
      }
    });
    return Object.values(grouped).sort((a, b) => a.category.localeCompare(b.category));
  };

  const toggleRoleExpanded = (roleId: string) => {
    setExpandedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  const fetchRoleUsers = async (roleId: string) => {
    if (roleUsers[roleId]) return; // Already fetched
    try {
      setLoadingUsers((prev) => ({ ...prev, [roleId]: true }));
      const data = await roleService.getRoleUsers(roleId);
      setRoleUsers((prev) => ({ ...prev, [roleId]: data }));
    } catch {
      toast.error('Failed to load users for this role');
    } finally {
      setLoadingUsers((prev) => ({ ...prev, [roleId]: false }));
    }
  };

  const handleExpandRole = (roleId: string) => {
    toggleRoleExpanded(roleId);
    if (activeTab === 'members' && !expandedRoles.includes(roleId)) {
      fetchRoleUsers(roleId);
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
        await roleService.updateRole(editingRole.id, {
          name: formData.name !== editingRole.name ? formData.name : undefined,
          description: formData.description !== editingRole.description ? formData.description : undefined,
          permissions: formData.permissions,
          priority: formData.priority !== editingRole.priority ? formData.priority : undefined,
        });
      } else {
        await roleService.createRole(formData);
      }

      await fetchData();
      setShowCreateModal(false);
      toast.success(editingRole ? 'Role updated successfully' : 'Role created successfully');
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
      toast.success('Role deleted successfully');
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

  const formatCategoryName = (name: string) =>
    name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-theme-text-primary">Role Management</h2>
            <p className="mt-1 text-sm text-theme-text-muted">
              Manage roles, permissions, and member assignments
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
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-theme-surface-border mb-6">
          <nav className="flex space-x-8" aria-label="Role management views">
            <button
              onClick={() => setActiveTab('permissions')}
              className={`flex items-center gap-2 pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'permissions'
                  ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
              }`}
            >
              <Shield className="w-4 h-4" />
              Roles & Permissions
            </button>
            <button
              onClick={() => setActiveTab('members')}
              className={`flex items-center gap-2 pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'members'
                  ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
              }`}
            >
              <Users className="w-4 h-4" />
              Role Assignments
            </button>
          </nav>
        </div>

        {/* ===== PERMISSIONS TAB ===== */}
        {activeTab === 'permissions' && (
          <div className="space-y-4">
            {roles.map((role) => {
              const isExpanded = expandedRoles.includes(role.id);
              const grouped = groupPermissionsByCategory(role.permissions);
              const hasWildcard = role.permissions.includes('*');

              return (
                <div
                  key={role.id}
                  className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden"
                >
                  {/* Role Header */}
                  <button
                    onClick={() => toggleRoleExpanded(role.id)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-theme-surface-hover transition-colors text-left"
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-theme-text-muted flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-theme-text-muted flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-semibold text-theme-text-primary">{role.name}</h3>
                          {role.is_system && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              System
                            </span>
                          )}
                          <span className="text-xs text-theme-text-muted">
                            {hasWildcard ? 'All permissions' : `${role.permissions.length} permission${role.permissions.length !== 1 ? 's' : ''}`}
                          </span>
                          <span className="text-xs text-theme-text-muted">
                            {role.user_count} member{role.user_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {role.description && (
                          <p className="mt-0.5 text-sm text-theme-text-muted truncate">{role.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleEdit(role)}
                        className="text-blue-700 dark:text-blue-400 hover:text-blue-600 text-sm font-medium px-2 py-1"
                      >
                        Edit
                      </button>
                      {!role.is_system && (
                        <button
                          onClick={() => handleDelete(role)}
                          className="text-red-700 dark:text-red-400 hover:text-red-600 text-sm font-medium px-2 py-1"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </button>

                  {/* Expanded Permission Detail */}
                  {isExpanded && (
                    <div className="px-6 pb-5 pt-1 border-t border-theme-surface-border">
                      {hasWildcard ? (
                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mt-3">
                          <p className="text-sm text-yellow-700 dark:text-yellow-300 font-medium">
                            This role has full access (wildcard permission). All current and future permissions are granted.
                          </p>
                        </div>
                      ) : grouped.length === 0 ? (
                        <p className="text-sm text-theme-text-muted mt-3">No permissions assigned to this role.</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
                          {grouped.map((group) => (
                            <div key={group.category} className="bg-theme-surface-secondary rounded-lg p-4">
                              <h4 className="text-sm font-semibold text-theme-text-primary mb-2 uppercase tracking-wide">
                                {formatCategoryName(group.category)}
                              </h4>
                              <ul className="space-y-1.5">
                                {group.permissions.map((perm) => (
                                  <li key={perm.name} className="flex items-start gap-2">
                                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full mt-1.5 flex-shrink-0" />
                                    <div>
                                      <span className="text-sm text-theme-text-primary">
                                        {perm.name.split('.').pop()?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                                      </span>
                                      <p className="text-xs text-theme-text-muted">{perm.description}</p>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ===== MEMBERS TAB ===== */}
        {activeTab === 'members' && (
          <div className="space-y-4">
            {roles.map((role) => {
              const isExpanded = expandedRoles.includes(role.id);
              const users = roleUsers[role.id];
              const isLoadingUsers = loadingUsers[role.id];

              return (
                <div
                  key={role.id}
                  className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden"
                >
                  {/* Role Header */}
                  <button
                    onClick={() => handleExpandRole(role.id)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-theme-surface-hover transition-colors text-left"
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-theme-text-muted flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-theme-text-muted flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-semibold text-theme-text-primary">{role.name}</h3>
                          {role.is_system && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              System
                            </span>
                          )}
                        </div>
                        {role.description && (
                          <p className="mt-0.5 text-sm text-theme-text-muted truncate">{role.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      <Users className="w-4 h-4 text-theme-text-muted" />
                      <span className={`text-sm font-semibold ${
                        role.user_count > 0 ? 'text-theme-text-primary' : 'text-theme-text-muted'
                      }`}>
                        {role.user_count} member{role.user_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </button>

                  {/* Expanded User List */}
                  {isExpanded && (
                    <div className="px-6 pb-5 pt-1 border-t border-theme-surface-border">
                      {isLoadingUsers ? (
                        <div className="flex items-center gap-2 py-4 justify-center">
                          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                          <span className="text-sm text-theme-text-muted">Loading members...</span>
                        </div>
                      ) : users && users.users.length > 0 ? (
                        <div className="mt-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {users.users.map((user: RoleUserItem) => (
                              <div
                                key={user.id}
                                className="flex items-center gap-3 bg-theme-surface-secondary rounded-lg p-3"
                              >
                                <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0">
                                  <User className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-theme-text-primary truncate">
                                    {user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username}
                                  </p>
                                  <p className="text-xs text-theme-text-muted truncate flex items-center gap-1">
                                    <Mail className="w-3 h-3" />
                                    {user.email}
                                  </p>
                                  {!user.is_active && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 mt-1">
                                      Inactive
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-theme-text-muted py-4 text-center">
                          No members are currently assigned to this role.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ===== Create/Edit Role Modal ===== */}
        {showCreateModal && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
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
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      System roles can only have their permissions modified.
                      Name and priority cannot be changed.
                    </p>
                  </div>
                )}

                <div>
                  <label htmlFor="role-name" className="block text-sm font-medium text-theme-text-primary">Role Name</label>
                  <input
                    id="role-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    disabled={editingRole?.is_system}
                    required
                    aria-required="true"
                    className="mt-1 block w-full rounded-md border-theme-input-border bg-theme-input-bg text-theme-text-primary shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-theme-surface-hover"
                  />
                </div>

                {!editingRole && (
                  <div>
                    <label htmlFor="role-slug" className="block text-sm font-medium text-theme-text-primary">Slug</label>
                    <input
                      id="role-slug"
                      type="text"
                      value={formData.slug}
                      onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                      className="mt-1 block w-full rounded-md border-theme-input-border bg-theme-input-bg text-theme-text-primary shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder="custom_role"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="role-description" className="block text-sm font-medium text-theme-text-primary">Description</label>
                  <textarea
                    id="role-description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="mt-1 block w-full rounded-md border-theme-input-border bg-theme-input-bg text-theme-text-primary shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                </div>

                {!editingRole?.is_system && (
                  <div>
                    <label htmlFor="role-priority" className="block text-sm font-medium text-theme-text-primary">Priority (0-100)</label>
                    <input
                      id="role-priority"
                      type="number"
                      min="0"
                      max="100"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                      className="mt-1 block w-32 rounded-md border-theme-input-border bg-theme-input-bg text-theme-text-primary shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    />
                    <p className="mt-1 text-xs text-theme-text-muted">Higher priority roles have more authority</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-3">Permissions</label>
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
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-input-border rounded"
                            />
                            <span className="ml-2 text-sm font-medium text-theme-text-primary uppercase">
                              {formatCategoryName(category.category)}
                            </span>
                          </label>
                          <div className="ml-6 space-y-1">
                            {category.permissions.map((perm) => (
                              <label key={perm.name} className="flex items-start cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formData.permissions.includes(perm.name)}
                                  onChange={() => handleTogglePermission(perm.name)}
                                  className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-input-border rounded"
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
                  className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-secondary"
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
