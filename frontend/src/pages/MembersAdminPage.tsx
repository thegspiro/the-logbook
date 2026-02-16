/**
 * Members Admin Page
 *
 * Administrative page for managing user roles and permissions.
 * Accessible to: IT Administrator, Chief, Assistant Chief, President,
 * Vice President, Secretary, Assistant Secretary
 *
 * Features:
 * - View by Member: See each member and their assigned roles
 * - View by Role: See each role and the members assigned to it
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { userService, roleService } from '../services/api';
import type { UserWithRoles, Role } from '../types/role';
import { useAuthStore } from '../stores/authStore';

type ViewMode = 'by-member' | 'by-role';

export const MembersAdminPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const [viewMode, setViewMode] = useState<ViewMode>('by-member');
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserWithRoles | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [editingRoles, setEditingRoles] = useState(false);
  const [editingMembers, setEditingMembers] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const canCreateMembers = checkPermission('users.create');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [usersData, rolesData] = await Promise.all([
        userService.getUsersWithRoles(),
        roleService.getRoles(),
      ]);

      setUsers(usersData);
      setRoles(rolesData);
    } catch (err) {
      setError('Unable to load members and roles. Please check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditRoles = (user: UserWithRoles) => {
    setSelectedUser(user);
    setSelectedRoleIds(user.roles.map((r) => r.id));
    setEditingRoles(true);
  };

  const handleEditMembers = (role: Role) => {
    setSelectedRole(role);
    // Find all users with this role
    const usersWithRole = users.filter((user) =>
      user.roles.some((r) => r.id === role.id)
    );
    setSelectedUserIds(usersWithRole.map((u) => u.id));
    setEditingMembers(true);
  };

  const handleSaveRoles = async () => {
    if (!selectedUser) return;

    try {
      setSaving(true);
      setError(null);

      await userService.assignUserRoles(selectedUser.id, selectedRoleIds);

      // Refresh the user list
      await fetchData();

      setEditingRoles(false);
      setSelectedUser(null);
    } catch (err) {
      setError('Unable to save role assignments. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMembers = async () => {
    if (!selectedRole) return;

    try {
      setSaving(true);
      setError(null);

      // Find users whose role assignments changed
      const currentUsersWithRole = users.filter((user) =>
        user.roles.some((r) => r.id === selectedRole.id)
      );
      const currentUserIds = currentUsersWithRole.map((u) => u.id);

      // Users to add the role to
      const usersToAdd = selectedUserIds.filter((id) => !currentUserIds.includes(id));
      // Users to remove the role from
      const usersToRemove = currentUserIds.filter((id) => !selectedUserIds.includes(id));

      // Update each user's roles
      const updatePromises = [];

      for (const userId of usersToAdd) {
        const user = users.find((u) => u.id === userId);
        if (user) {
          const newRoleIds = [...user.roles.map((r) => r.id), selectedRole.id];
          updatePromises.push(userService.assignUserRoles(userId, newRoleIds));
        }
      }

      for (const userId of usersToRemove) {
        const user = users.find((u) => u.id === userId);
        if (user) {
          const newRoleIds = user.roles.map((r) => r.id).filter((id) => id !== selectedRole.id);
          updatePromises.push(userService.assignUserRoles(userId, newRoleIds));
        }
      }

      await Promise.all(updatePromises);

      // Refresh the user list
      await fetchData();

      setEditingMembers(false);
      setSelectedRole(null);
    } catch (err) {
      setError('Unable to update member assignments. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
    );
  };

  const handleToggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleQuickRemoveRole = async (user: UserWithRoles, roleId: string) => {
    if (!confirm(`Remove role from ${user.full_name || user.username}?`)) {
      return;
    }

    try {
      setError(null);
      const newRoleIds = user.roles.map((r) => r.id).filter((id) => id !== roleId);
      await userService.assignUserRoles(user.id, newRoleIds);
      await fetchData();
    } catch (err) {
      setError('Unable to remove the role. Please check your connection and try again.');
    }
  };

  const handleQuickRemoveUser = async (userId: string, role: Role) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    if (!confirm(`Remove ${user.full_name || user.username} from ${role.name}?`)) {
      return;
    }

    try {
      setError(null);
      const newRoleIds = user.roles.map((r) => r.id).filter((id) => id !== role.id);
      await userService.assignUserRoles(userId, newRoleIds);
      await fetchData();
    } catch (err) {
      setError('Unable to remove the user from this role. Please check your connection and try again.');
    }
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

  if (error && !editingRoles && !editingMembers) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Members Administration</h2>
          <p className="mt-1 text-sm text-theme-text-muted">
            Manage member roles and permissions
          </p>
        </div>
        {canCreateMembers && (
          <Link
            to="/admin/members/add"
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <svg
              className="-ml-1 mr-2 h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            Add Member
          </Link>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* View Toggle */}
      <div className="mb-6">
        <div className="inline-flex rounded-md shadow-sm" role="group" aria-label="View mode">
          <button
            type="button"
            onClick={() => setViewMode('by-member')}
            className={`px-4 py-2 text-sm font-medium border ${
              viewMode === 'by-member'
                ? 'bg-blue-600 text-white border-blue-600 z-10'
                : 'bg-theme-surface text-theme-text-secondary border-white/30 hover:bg-theme-surface-secondary'
            } rounded-l-lg focus:z-10 focus:ring-2 focus:ring-blue-500`}
          >
            View by Member
          </button>
          <button
            type="button"
            onClick={() => setViewMode('by-role')}
            className={`px-4 py-2 text-sm font-medium border ${
              viewMode === 'by-role'
                ? 'bg-blue-600 text-white border-blue-600 z-10'
                : 'bg-theme-surface text-theme-text-secondary border-white/30 hover:bg-theme-surface-secondary'
            } rounded-r-lg focus:z-10 focus:ring-2 focus:ring-blue-500`}
          >
            View by Role
          </button>
        </div>
      </div>

      {/* View by Member */}
      {viewMode === 'by-member' && (
        <div className="bg-theme-surface backdrop-blur-sm shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-white/10" aria-label="Members and their roles">
            <thead className="bg-theme-input-bg">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Member
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Badge
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Roles
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-theme-surface-secondary">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-theme-surface flex items-center justify-center">
                        <span className="text-theme-text-secondary font-medium">
                          {(user.first_name?.[0] || user.username[0]).toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-theme-text-primary">
                          {user.full_name || user.username}
                        </div>
                        <div className="text-sm text-theme-text-muted">@{user.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-theme-text-muted">
                    {user.badge_number || '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length === 0 ? (
                        <span className="text-sm text-slate-500">No roles</span>
                      ) : (
                        user.roles.map((role) => (
                          <span
                            key={role.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                              role.is_system
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-theme-surface text-slate-200'
                            }`}
                          >
                            {role.name}
                            <button
                              onClick={() => handleQuickRemoveRole(user, role.id)}
                              className="ml-1 hover:text-red-600"
                              aria-label={`Remove ${role.name} role from ${user.full_name || user.username}`}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        user.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEditRoles(user)}
                      className="text-blue-700 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                    >
                      Manage Roles
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View by Role */}
      {viewMode === 'by-role' && (
        <div className="space-y-4">
          {roles.map((role) => {
            const usersWithRole = users.filter((user) =>
              user.roles.some((r) => r.id === role.id)
            );

            return (
              <div key={role.id} className="bg-theme-surface backdrop-blur-sm shadow sm:rounded-lg">
                <div className="px-6 py-4 border-b border-theme-surface-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-medium text-theme-text-primary">{role.name}</h3>
                        {role.is_system && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            System
                          </span>
                        )}
                      </div>
                      {role.description && (
                        <p className="mt-1 text-sm text-theme-text-muted">{role.description}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        {role.permissions.length} permissions • {usersWithRole.length} members
                      </p>
                    </div>
                    <button
                      onClick={() => handleEditMembers(role)}
                      className="px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 border border-blue-400 rounded-md hover:bg-theme-surface-secondary"
                    >
                      Manage Members
                    </button>
                  </div>
                </div>
                <div className="px-6 py-4">
                  {usersWithRole.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">No members assigned to this role</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {usersWithRole.map((user) => (
                        <div
                          key={user.id}
                          className="inline-flex items-center gap-2 px-3 py-2 bg-theme-surface-secondary rounded-lg hover:bg-theme-surface-hover"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-theme-surface flex items-center justify-center">
                              <span className="text-xs text-theme-text-muted font-medium">
                                {(user.first_name?.[0] || user.username[0]).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-theme-text-primary">
                                {user.full_name || user.username}
                              </div>
                              {user.badge_number && (
                                <div className="text-xs text-theme-text-muted">#{user.badge_number}</div>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleQuickRemoveUser(user.id, role)}
                            className="ml-2 text-slate-500 hover:text-red-600"
                            aria-label={`Remove ${user.full_name || user.username} from ${role.name}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Role Assignment Modal (for View by Member) */}
      {editingRoles && selectedUser && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-roles-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setEditingRoles(false); setSelectedUser(null); setError(null); } }}
        >
          <div className="bg-slate-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-theme-surface-border">
              <h3 id="manage-roles-title" className="text-lg font-medium text-theme-text-primary">
                Manage Roles for {selectedUser.full_name || selectedUser.username}
              </h3>
            </div>

            <div className="px-6 py-4">
              <p className="text-sm text-theme-text-muted mb-4">
                Select the roles to assign to this member
              </p>

              <div className="space-y-2">
                {roles.map((role) => (
                  <label
                    key={role.id}
                    className="flex items-start p-3 rounded-lg hover:bg-theme-surface-secondary cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={() => handleToggleRole(role.id)}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-input-border rounded"
                    />
                    <div className="ml-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-theme-text-primary">
                          {role.name}
                        </span>
                        {role.is_system && (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                            System
                          </span>
                        )}
                      </div>
                      {role.description && (
                        <p className="text-xs text-theme-text-muted mt-1">{role.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-theme-surface-border flex justify-end gap-3">
              <button
                onClick={() => {
                  setEditingRoles(false);
                  setSelectedUser(null);
                  setError(null);
                }}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-slate-800 border border-white/30 rounded-md hover:bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRoles}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Member Assignment Modal (for View by Role) */}
      {editingMembers && selectedRole && (
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-members-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setEditingMembers(false); setSelectedRole(null); setError(null); } }}
        >
          <div className="bg-slate-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-theme-surface-border">
              <h3 id="manage-members-title" className="text-lg font-medium text-theme-text-primary">
                Manage Members for {selectedRole.name}
              </h3>
            </div>

            <div className="px-6 py-4">
              <p className="text-sm text-theme-text-muted mb-4">
                Select the members to assign to this role
              </p>

              <div className="space-y-2">
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-start p-3 rounded-lg hover:bg-theme-surface-secondary cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(user.id)}
                      onChange={() => handleToggleUser(user.id)}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-input-border rounded"
                    />
                    <div className="ml-3 flex items-center gap-2">
                      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-theme-surface flex items-center justify-center">
                        <span className="text-xs text-theme-text-muted font-medium">
                          {(user.first_name?.[0] || user.username[0]).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-theme-text-primary">
                          {user.full_name || user.username}
                        </div>
                        <div className="text-xs text-theme-text-muted">
                          @{user.username}
                          {user.badge_number && ` • Badge #${user.badge_number}`}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-theme-surface-border flex justify-end gap-3">
              <button
                onClick={() => {
                  setEditingMembers(false);
                  setSelectedRole(null);
                  setError(null);
                }}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-theme-text-secondary bg-slate-800 border border-white/30 rounded-md hover:bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMembers}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default MembersAdminPage;
