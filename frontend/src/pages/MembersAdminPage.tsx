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
import { userService, roleService } from '../services/api';
import type { UserWithRoles, Role } from '../types/role';

type ViewMode = 'by-member' | 'by-role';

export const MembersAdminPage: React.FC = () => {
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
      console.error('Error fetching data:', err);
      setError('Failed to load data. Please try again later.');
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
      console.error('Error saving roles:', err);
      setError('Failed to save roles. Please try again.');
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
      console.error('Error saving members:', err);
      setError('Failed to save member assignments. Please try again.');
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
      console.error('Error removing role:', err);
      setError('Failed to remove role. Please try again.');
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
      console.error('Error removing user:', err);
      setError('Failed to remove user from role. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (error && !editingRoles && !editingMembers) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex">
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Members Administration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Manage member roles and permissions
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* View Toggle */}
      <div className="mb-6">
        <div className="inline-flex rounded-md shadow-sm" role="group">
          <button
            type="button"
            onClick={() => setViewMode('by-member')}
            className={`px-4 py-2 text-sm font-medium border ${
              viewMode === 'by-member'
                ? 'bg-blue-600 text-white border-blue-600 z-10'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
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
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            } rounded-r-lg focus:z-10 focus:ring-2 focus:ring-blue-500`}
          >
            View by Role
          </button>
        </div>
      </div>

      {/* View by Member */}
      {viewMode === 'by-member' && (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Member
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Badge
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Roles
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                        <span className="text-gray-500 font-medium">
                          {(user.first_name?.[0] || user.username[0]).toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {user.full_name || user.username}
                        </div>
                        <div className="text-sm text-gray-500">@{user.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.badge_number || '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length === 0 ? (
                        <span className="text-sm text-gray-400">No roles</span>
                      ) : (
                        user.roles.map((role) => (
                          <span
                            key={role.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                              role.is_system
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {role.name}
                            <button
                              onClick={() => handleQuickRemoveRole(user, role.id)}
                              className="ml-1 hover:text-red-600"
                              title="Remove role"
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
                      className="text-blue-600 hover:text-blue-900"
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
              <div key={role.id} className="bg-white shadow sm:rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-medium text-gray-900">{role.name}</h3>
                        {role.is_system && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            System
                          </span>
                        )}
                      </div>
                      {role.description && (
                        <p className="mt-1 text-sm text-gray-500">{role.description}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-400">
                        {role.permissions.length} permissions • {usersWithRole.length} members
                      </p>
                    </div>
                    <button
                      onClick={() => handleEditMembers(role)}
                      className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-900 border border-blue-600 rounded-md hover:bg-blue-50"
                    >
                      Manage Members
                    </button>
                  </div>
                </div>
                <div className="px-6 py-4">
                  {usersWithRole.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No members assigned to this role</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {usersWithRole.map((user) => (
                        <div
                          key={user.id}
                          className="inline-flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                              <span className="text-xs text-gray-500 font-medium">
                                {(user.first_name?.[0] || user.username[0]).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {user.full_name || user.username}
                              </div>
                              {user.badge_number && (
                                <div className="text-xs text-gray-500">#{user.badge_number}</div>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleQuickRemoveUser(user.id, role)}
                            className="ml-2 text-gray-400 hover:text-red-600"
                            title="Remove from role"
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
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Manage Roles for {selectedUser.full_name || selectedUser.username}
              </h3>
            </div>

            <div className="px-6 py-4">
              <p className="text-sm text-gray-500 mb-4">
                Select the roles to assign to this member
              </p>

              <div className="space-y-2">
                {roles.map((role) => (
                  <label
                    key={role.id}
                    className="flex items-start p-3 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoleIds.includes(role.id)}
                      onChange={() => handleToggleRole(role.id)}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div className="ml-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {role.name}
                        </span>
                        {role.is_system && (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                            System
                          </span>
                        )}
                      </div>
                      {role.description && (
                        <p className="text-xs text-gray-500 mt-1">{role.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setEditingRoles(false);
                  setSelectedUser(null);
                  setError(null);
                }}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
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
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Manage Members for {selectedRole.name}
              </h3>
            </div>

            <div className="px-6 py-4">
              <p className="text-sm text-gray-500 mb-4">
                Select the members to assign to this role
              </p>

              <div className="space-y-2">
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-start p-3 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(user.id)}
                      onChange={() => handleToggleUser(user.id)}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div className="ml-3 flex items-center gap-2">
                      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                        <span className="text-xs text-gray-500 font-medium">
                          {(user.first_name?.[0] || user.username[0]).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {user.full_name || user.username}
                        </div>
                        <div className="text-xs text-gray-500">
                          @{user.username}
                          {user.badge_number && ` • Badge #${user.badge_number}`}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setEditingMembers(false);
                  setSelectedRole(null);
                  setError(null);
                }}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
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
  );
};

export default MembersAdminPage;
