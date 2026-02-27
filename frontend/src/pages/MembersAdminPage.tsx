/**
 * Members Admin Page
 *
 * Administrative page for managing user roles, permissions, and contact information.
 * Accessible to: IT Administrator, Chief, Assistant Chief, President,
 * Vice President, Secretary, Assistant Secretary
 *
 * Features:
 * - View by Member: See each member and their assigned roles
 * - View by Role: See each role and the members assigned to it
 * - Edit member contact information (admin)
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { userService, roleService, locationsService } from '../services/api';
import type { Location } from '../services/api';
import type { UserWithRoles, Role } from '../types/role';
import type { UserProfileUpdate } from '../types/user';
import { useAuthStore } from '../stores/authStore';
import { validatePasswordStrength } from '../utils/passwordValidation';
import { Modal } from '../components/Modal';
import { DeleteMemberModal } from '../components/DeleteMemberModal';
import { useRanks } from '../hooks/useRanks';

type ViewMode = 'by-member' | 'by-role';

interface EditProfileForm {
  first_name: string;
  middle_name: string;
  last_name: string;
  phone: string;
  mobile: string;
  membership_number: string;
  rank: string;
  station: string;
}

export const MembersAdminPage: React.FC = () => {
  const navigate = useNavigate();
  const { checkPermission, user: currentUser } = useAuthStore();
  const { rankOptions } = useRanks();
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

  // Edit contact info state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileUser, setProfileUser] = useState<UserWithRoles | null>(null);
  const [profileForm, setProfileForm] = useState<EditProfileForm>({
    first_name: '',
    middle_name: '',
    last_name: '',
    phone: '',
    mobile: '',
    membership_number: '',
    rank: '',
    station: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Reset password state
  const [resetPasswordUser, setResetPasswordUser] = useState<UserWithRoles | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetForceChange, setResetForceChange] = useState(true);
  const [savingReset, setSavingReset] = useState(false);

  // Delete modal state
  const [deleteModalUser, setDeleteModalUser] = useState<UserWithRoles | null>(null);

  // Station lookup
  const [availableStations, setAvailableStations] = useState<Location[]>([]);

  const canCreateMembers = checkPermission('users.create');

  useEffect(() => {
    void fetchData();

    // Load stations for dropdown (top-level locations with an address)
    locationsService.getLocations({ is_active: true }).then((locs) => {
      const stations = locs.filter((l: Location) => l.address && !l.room_number);
      setAvailableStations(stations);
    }).catch(() => { /* non-critical UI data */ });
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
    } catch (_err) {
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

  const _handleEditProfile = async (user: UserWithRoles) => {
    // Fetch full profile for the user to get all fields
    try {
      const fullProfile = await userService.getUserWithRoles(user.id);
      setProfileUser(fullProfile);
      setProfileForm({
        first_name: fullProfile.first_name || '',
        middle_name: fullProfile.middle_name || '',
        last_name: fullProfile.last_name || '',
        phone: fullProfile.phone || '',
        mobile: fullProfile.mobile || '',
        membership_number: fullProfile.membership_number || '',
        rank: fullProfile.rank || '',
        station: fullProfile.station || '',
      });
      setEditingProfile(true);
    } catch (_err) {
      setError('Unable to load member profile. Please try again.');
    }
  };

  const handleSaveProfile = async () => {
    if (!profileUser) return;

    try {
      setSavingProfile(true);
      setError(null);

      const updateData: UserProfileUpdate = {};
      // Only send changed fields
      if (profileForm.first_name !== (profileUser.first_name || '')) updateData.first_name = profileForm.first_name;
      if (profileForm.middle_name !== (profileUser.middle_name || '')) updateData.middle_name = profileForm.middle_name;
      if (profileForm.last_name !== (profileUser.last_name || '')) updateData.last_name = profileForm.last_name;
      if (profileForm.phone !== (profileUser.phone || '')) updateData.phone = profileForm.phone;
      if (profileForm.mobile !== (profileUser.mobile || '')) updateData.mobile = profileForm.mobile;
      if (profileForm.membership_number !== (profileUser.membership_number || '')) updateData.membership_number = profileForm.membership_number;
      if (profileForm.rank !== (profileUser.rank || '')) updateData.rank = profileForm.rank;
      if (profileForm.station !== (profileUser.station || '')) updateData.station = profileForm.station;

      await userService.updateUserProfile(profileUser.id, updateData);

      // Refresh the user list
      await fetchData();

      setEditingProfile(false);
      setProfileUser(null);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string }; status?: number } })?.response?.data?.detail;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('You do not have permission to update member information. Contact an administrator.');
      } else {
        setError(detail || 'Unable to update member information. Please try again.');
      }
    } finally {
      setSavingProfile(false);
    }
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
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string }; status?: number } })?.response?.data?.detail;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('You do not have permission to assign roles. Contact an administrator.');
      } else {
        setError(detail || 'Unable to save role assignments. Please try again.');
      }
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
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string }; status?: number } })?.response?.data?.detail;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('You do not have permission to assign roles. Contact an administrator.');
      } else {
        setError(detail || 'Unable to update member assignments. Please try again.');
      }
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
    } catch (_err) {
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
    } catch (_err) {
      setError('Unable to remove the user from this role. Please check your connection and try again.');
    }
  };

  const handleDeleteUser = (user: UserWithRoles) => {
    setDeleteModalUser(user);
  };

  const handleSoftDelete = async (userId: string) => {
    try {
      setError(null);
      await userService.deleteUserWithMode(userId, false);
      setDeleteModalUser(null);
      await fetchData();
    } catch (_err) {
      setError('Unable to deactivate the member. Please try again.');
    }
  };

  const handleHardDelete = async (userId: string) => {
    try {
      setError(null);
      await userService.deleteUserWithMode(userId, true);
      setDeleteModalUser(null);
      await fetchData();
    } catch (_err) {
      setError('Unable to permanently delete the member. Please try again.');
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser) return;

    if (resetNewPassword !== resetConfirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const validation = validatePasswordStrength(resetNewPassword);
    if (!validation.isValid) {
      setError('Password does not meet strength requirements');
      return;
    }

    try {
      setSavingReset(true);
      setError(null);
      await userService.adminResetPassword(resetPasswordUser.id, resetNewPassword, resetForceChange);
      setResetPasswordUser(null);
      setResetNewPassword('');
      setResetConfirmPassword('');
      setResetForceChange(true);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Unable to reset password. Please try again.');
    } finally {
      setSavingReset(false);
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

  if (error && !editingRoles && !editingMembers && !editingProfile) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm text-red-400">{error}</p>
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
            Manage member roles, permissions, and contact information
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
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-sm text-red-400">{error}</p>
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
                : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
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
                : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
            } rounded-r-lg focus:z-10 focus:ring-2 focus:ring-blue-500`}
          >
            View by Role
          </button>
        </div>
      </div>

      {/* View by Member */}
      {viewMode === 'by-member' && (
        <div className="bg-theme-surface backdrop-blur-sm shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-theme-surface-border" aria-label="Members and their roles">
            <thead className="bg-theme-surface-secondary">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Member
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Member #
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
            <tbody className="divide-y divide-theme-surface-border">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-theme-surface-hover">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-theme-surface flex items-center justify-center">
                        <span className="text-theme-text-secondary font-medium">
                          {(user.first_name?.[0] ?? user.username[0] ?? '').toUpperCase()}
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
                    {user.membership_number || '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length === 0 ? (
                        <span className="text-sm text-theme-text-muted">No roles</span>
                      ) : (
                        user.roles.map((role) => (
                          <span
                            key={role.id}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                              role.is_system
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400'
                                : 'bg-theme-surface text-theme-text-secondary'
                            }`}
                          >
                            {role.name}
                            <button
                              onClick={() => { void handleQuickRemoveRole(user, role.id); }}
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
                          ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => navigate(`/members/admin/edit/${user.id}`)}
                        className="text-green-400 hover:text-green-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleEditRoles(user)}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Manage Roles
                      </button>
                      {currentUser?.id !== user.id && (
                        <button
                          onClick={() => setResetPasswordUser(user)}
                          className="text-yellow-400 hover:text-yellow-300"
                        >
                          Reset Password
                        </button>
                      )}
                      {currentUser?.id !== user.id && (
                        <button
                          onClick={() => handleDeleteUser(user)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      )}
                    </div>
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
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                            System
                          </span>
                        )}
                      </div>
                      {role.description && (
                        <p className="mt-1 text-sm text-theme-text-muted">{role.description}</p>
                      )}
                      <p className="mt-1 text-xs text-theme-text-muted">
                        {role.permissions.length} permissions • {usersWithRole.length} members
                      </p>
                    </div>
                    <button
                      onClick={() => handleEditMembers(role)}
                      className="px-4 py-2 text-sm font-medium text-blue-400 hover:text-blue-300 border border-blue-400 rounded-md hover:bg-theme-surface-hover"
                    >
                      Manage Members
                    </button>
                  </div>
                </div>
                <div className="px-6 py-4">
                  {usersWithRole.length === 0 ? (
                    <p className="text-sm text-theme-text-muted italic">No members assigned to this role</p>
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
                                {(user.first_name?.[0] || user.username[0] || '').toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-theme-text-primary">
                                {user.full_name || user.username}
                              </div>
                              {user.membership_number && (
                                <div className="text-xs text-theme-text-muted">#{user.membership_number}</div>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => { void handleQuickRemoveUser(user.id, role); }}
                            className="ml-2 text-theme-text-muted hover:text-red-600"
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

      {/* Edit Profile Modal */}
      <Modal
        isOpen={editingProfile && !!profileUser}
        onClose={() => { setEditingProfile(false); setProfileUser(null); setError(null); }}
        title={`Edit Information for ${profileUser?.full_name || profileUser?.username}`}
        footer={
          <>
            <button
              onClick={() => { void handleSaveProfile(); }}
              disabled={savingProfile}
              className="w-full sm:w-auto sm:ml-3 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
            >
              {savingProfile ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={() => { setEditingProfile(false); setProfileUser(null); setError(null); }}
              disabled={savingProfile}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Name Fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">First Name</label>
              <input
                type="text"
                value={profileForm.first_name}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, first_name: e.target.value }))}
                className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={savingProfile}
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Middle Name</label>
              <input
                type="text"
                value={profileForm.middle_name}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, middle_name: e.target.value }))}
                className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={savingProfile}
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Last Name</label>
              <input
                type="text"
                value={profileForm.last_name}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, last_name: e.target.value }))}
                className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={savingProfile}
              />
            </div>
          </div>

          {/* Contact Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Phone</label>
              <input
                type="tel"
                value={profileForm.phone}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={savingProfile}
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Mobile</label>
              <input
                type="tel"
                value={profileForm.mobile}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, mobile: e.target.value }))}
                className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={savingProfile}
              />
            </div>
          </div>

          {/* Department Fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Membership #</label>
              <input
                type="text"
                value={profileForm.membership_number}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, membership_number: e.target.value }))}
                className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={savingProfile}
              />
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Rank</label>
              <select
                value={profileForm.rank}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, rank: e.target.value }))}
                className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={savingProfile}
              >
                <option value="">Select Rank</option>
                {rankOptions.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Station</label>
              <select
                value={profileForm.station}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, station: e.target.value }))}
                className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={savingProfile}
              >
                <option value="">Select Station</option>
                {availableStations.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-400">{error}</div>
          )}
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={!!resetPasswordUser}
        onClose={() => { setResetPasswordUser(null); setResetNewPassword(''); setResetConfirmPassword(''); setError(null); }}
        title={`Reset Password for ${resetPasswordUser?.full_name || resetPasswordUser?.username}`}
        footer={
          <>
            <button
              onClick={() => { void handleResetPassword(); }}
              disabled={savingReset || !resetNewPassword || resetNewPassword !== resetConfirmPassword}
              className="w-full sm:w-auto sm:ml-3 px-4 py-2 text-sm font-medium text-white bg-yellow-600 border border-transparent rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
            >
              {savingReset ? 'Resetting...' : 'Reset Password'}
            </button>
            <button
              onClick={() => { setResetPasswordUser(null); setResetNewPassword(''); setResetConfirmPassword(''); setError(null); }}
              disabled={savingReset}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">New Password</label>
            <input
              type="password"
              value={resetNewPassword}
              onChange={(e) => setResetNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Minimum 12 characters"
              disabled={savingReset}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Confirm Password</label>
            <input
              type="password"
              value={resetConfirmPassword}
              onChange={(e) => setResetConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Re-enter password"
              disabled={savingReset}
              autoComplete="new-password"
            />
            {resetConfirmPassword && resetNewPassword !== resetConfirmPassword && (
              <p className="mt-1 text-xs text-red-400">Passwords do not match</p>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={resetForceChange}
              onChange={(e) => setResetForceChange(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
              disabled={savingReset}
            />
            <span className="text-sm text-theme-text-secondary">
              Require user to change password on next login
            </span>
          </label>

          {error && (
            <div className="text-sm text-red-400">{error}</div>
          )}
        </div>
      </Modal>

      {/* Role Assignment Modal (for View by Member) */}
      <Modal
        isOpen={editingRoles && !!selectedUser}
        onClose={() => { setEditingRoles(false); setSelectedUser(null); setError(null); }}
        title={`Manage Roles for ${selectedUser?.full_name || selectedUser?.username}`}
        footer={
          <>
            <button
              onClick={() => { void handleSaveRoles(); }}
              disabled={saving}
              className="w-full sm:w-auto sm:ml-3 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={() => { setEditingRoles(false); setSelectedUser(null); setError(null); }}
              disabled={saving}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        }
      >
        <p className="text-sm text-theme-text-muted mb-4">
          Select the roles to assign to this member
        </p>

        <div className="space-y-2">
          {roles.map((role) => (
            <label
              key={role.id}
              className="flex items-start p-3 rounded-lg hover:bg-theme-surface-hover cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedRoleIds.includes(role.id)}
                onChange={() => handleToggleRole(role.id)}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
              />
              <div className="ml-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-theme-text-primary">
                    {role.name}
                  </span>
                  {role.is_system && (
                    <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400 px-2 py-0.5 rounded">
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
      </Modal>

      {/* Member Assignment Modal (for View by Role) */}
      <Modal
        isOpen={editingMembers && !!selectedRole}
        onClose={() => { setEditingMembers(false); setSelectedRole(null); setError(null); }}
        title={`Manage Members for ${selectedRole?.name}`}
        footer={
          <>
            <button
              onClick={() => { void handleSaveMembers(); }}
              disabled={saving}
              className="w-full sm:w-auto sm:ml-3 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={() => { setEditingMembers(false); setSelectedRole(null); setError(null); }}
              disabled={saving}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-theme-text-secondary bg-theme-surface border border-theme-surface-border rounded-md hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-[var(--ring-offset-bg)] disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        }
      >
        <p className="text-sm text-theme-text-muted mb-4">
          Select the members to assign to this role
        </p>

        <div className="space-y-2">
          {users.map((user) => (
            <label
              key={user.id}
              className="flex items-start p-3 rounded-lg hover:bg-theme-surface-hover cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedUserIds.includes(user.id)}
                onChange={() => handleToggleUser(user.id)}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
              />
              <div className="ml-3 flex items-center gap-2">
                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-theme-surface flex items-center justify-center">
                  <span className="text-xs text-theme-text-muted font-medium">
                    {(user.first_name?.[0] || user.username[0] || '').toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-medium text-theme-text-primary">
                    {user.full_name || user.username}
                  </div>
                  <div className="text-xs text-theme-text-muted">
                    @{user.username}
                    {user.membership_number && ` • #${user.membership_number}`}
                  </div>
                </div>
              </div>
            </label>
          ))}
        </div>
      </Modal>

      {/* Delete Member Modal */}
      <DeleteMemberModal
        isOpen={!!deleteModalUser}
        onClose={() => setDeleteModalUser(null)}
        member={deleteModalUser}
        onSoftDelete={handleSoftDelete}
        onHardDelete={handleHardDelete}
      />
      </div>
    </div>
  );
};

export default MembersAdminPage;
