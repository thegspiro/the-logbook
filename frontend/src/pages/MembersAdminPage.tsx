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
import { Link, useNavigate } from 'react-router';
import { userService, roleService, locationsService } from '../services/api';
import type { Location } from '../services/api';
import type { UserWithRoles, Role } from '../types/role';
import type { UserProfileUpdate } from '../types/user';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';
import { PASSWORD_CHECKLIST, validatePasswordStrength } from '../utils/passwordValidation';
import { getErrorDetail, getErrorMessage } from '../utils/errorHandling';
import { Modal } from '../components/Modal';
import { DeleteMemberModal } from '../components/DeleteMemberModal';
import { useRanks } from '../hooks/useRanks';
import { UserStatus } from '../constants/enums';
import { useConfirm } from '../contexts/ConfirmContext';
import { ADMINISTRATIVE_RANK_HINT, isAdministrativeMember } from '../utils/membership';
import { displayNameOf, givenName } from '../utils/memberName';

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
  const { confirm } = useConfirm();
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

  // Reset MFA state
  const [resetMfaUser, setResetMfaUser] = useState<UserWithRoles | null>(null);
  const [savingMfaReset, setSavingMfaReset] = useState(false);

  // Delete modal state
  const [deleteModalUser, setDeleteModalUser] = useState<UserWithRoles | null>(null);

  // Station lookup
  const [availableStations, setAvailableStations] = useState<Location[]>([]);

  const canCreateMembers = checkPermission('users.create');

  useEffect(() => {
    void fetchData();

    // Load stations for dropdown (exclude rooms — they belong to facilities)
    locationsService
      .getLocations({ is_active: true, exclude_rooms: true })
      .then((locs) => {
        setAvailableStations(locs.filter((l: Location) => l.address));
      })
      .catch(() => {
        /* non-critical UI data */
      });
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [usersData, rolesData] = await Promise.all([userService.getUsersWithRoles(), roleService.getRoles()]);

      setUsers(usersData);
      setRoles(rolesData);
    } catch (_err) {
      setError('Unable to load members and roles. Check your connection and refresh the page.');
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
    const usersWithRole = users.filter((user) => user.roles.some((r) => r.id === role.id));
    setSelectedUserIds(usersWithRole.map((u) => u.id));
    setEditingMembers(true);
  };

  // This drawer edits the profile but not the membership type, so the class is
  // read-only here: the rank field is greyed rather than cleared. Changing an
  // administrative member's class is done on the full edit page.
  const profileIsAdministrative = isAdministrativeMember(undefined, profileUser?.membership_type);

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
      if (profileForm.membership_number !== (profileUser.membership_number || ''))
        updateData.membership_number = profileForm.membership_number;
      if (profileForm.rank !== (profileUser.rank || '')) updateData.rank = profileForm.rank;
      if (profileForm.station !== (profileUser.station || '')) updateData.station = profileForm.station;

      await userService.updateUserProfile(profileUser.id, updateData);

      // Refresh the user list
      await fetchData();

      setEditingProfile(false);
      setProfileUser(null);
    } catch (err: unknown) {
      const detail = getErrorDetail(err);
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('You do not have permission to update member information. Contact an administrator.');
      } else {
        setError(detail || 'Unable to update member information. Try again.');
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
      const detail = getErrorDetail(err);
      const status = (err as { response?: { status?: number } })?.response?.status;
      // A 403 here is usually the grant ceiling — the caller may assign
      // positions, just not one that carries more than they hold — so the
      // server's reason is the useful part (workflow review W05).
      if (status === 403) {
        setError(detail || 'You do not have permission to assign roles. Contact an administrator.');
      } else {
        setError(detail || 'Unable to save role assignments. Try again.');
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
      const currentUsersWithRole = users.filter((user) => user.roles.some((r) => r.id === selectedRole.id));
      const currentUserIds = currentUsersWithRole.map((u) => u.id);

      // Users to add the role to
      const usersToAdd = selectedUserIds.filter((id) => !currentUserIds.includes(id));
      // Users to remove the role from
      const usersToRemove = currentUserIds.filter((id) => !selectedUserIds.includes(id));

      const changes: { user: UserWithRoles; roleIds: string[] }[] = [];
      for (const userId of usersToAdd) {
        const user = users.find((u) => u.id === userId);
        if (user) changes.push({ user, roleIds: [...user.roles.map((r) => r.id), selectedRole.id] });
      }
      for (const userId of usersToRemove) {
        const user = users.find((u) => u.id === userId);
        if (user) changes.push({ user, roleIds: user.roles.map((r) => r.id).filter((id) => id !== selectedRole.id) });
      }

      // One member at a time, not `Promise.all`. In parallel, a refusal
      // rejected the whole save while the other requests still landed, and the
      // page neither reloaded nor said which ones had. Sequential requests also
      // keep the server's last-administrator check from judging several
      // removals against the same, not-yet-updated count.
      const failures: { name: string; reason: string }[] = [];
      for (const { user, roleIds } of changes) {
        try {
          await userService.assignUserRoles(user.id, roleIds);
        } catch (err: unknown) {
          failures.push({
            name: displayNameOf(user) || user.username,
            reason: getErrorDetail(err) || 'the change was refused',
          });
        }
      }

      await fetchData();

      if (failures.length > 0) {
        const saved = changes.length - failures.length;
        const listed = failures.map((f) => `${f.name}: ${f.reason}`).join(' ');
        setError(`${saved} of ${changes.length} change${changes.length === 1 ? '' : 's'} saved. Not saved — ${listed}`);
        return;
      }

      setEditingMembers(false);
      setSelectedRole(null);
    } catch (err: unknown) {
      const detail = getErrorDetail(err);
      const status = (err as { response?: { status?: number } })?.response?.status;
      // A 403 here is usually the grant ceiling — the caller may assign
      // positions, just not one that carries more than they hold — so the
      // server's reason is the useful part (workflow review W05).
      if (status === 403) {
        setError(detail || 'You do not have permission to assign roles. Contact an administrator.');
      } else {
        setError(detail || 'Unable to update member assignments. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]));
  };

  const handleToggleUser = (userId: string) => {
    setSelectedUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const handleQuickRemoveRole = async (user: UserWithRoles, roleId: string) => {
    const roleName = user.roles.find((r) => r.id === roleId)?.name ?? 'this role';
    if (
      !(await confirm({
        title: 'Remove role',
        message: `Remove ${roleName} from ${displayNameOf(user) || user.username}?`,
        confirmLabel: 'Remove',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }

    try {
      setError(null);
      const newRoleIds = user.roles.map((r) => r.id).filter((id) => id !== roleId);
      await userService.assignUserRoles(user.id, newRoleIds);
      await fetchData();
    } catch (err: unknown) {
      // The server refuses on purpose — the last administrator, the grant
      // ceiling — and its reason is the useful part; "check your connection"
      // sent the officer looking for a network fault.
      setError(getErrorDetail(err) || 'Unable to remove the role. Check your connection and try again.');
    }
  };

  const handleQuickRemoveUser = async (userId: string, role: Role) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    if (
      !(await confirm({
        title: 'Remove from role',
        message: `Remove ${displayNameOf(user) || user.username} from ${role.name}?`,
        confirmLabel: 'Remove',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }

    try {
      setError(null);
      const newRoleIds = user.roles.map((r) => r.id).filter((id) => id !== role.id);
      await userService.assignUserRoles(userId, newRoleIds);
      await fetchData();
    } catch (err: unknown) {
      setError(
        getErrorDetail(err) || 'Unable to remove the member from this role. Check your connection and try again.'
      );
    }
  };

  const handleResetMfa = async () => {
    if (!resetMfaUser) return;
    try {
      setSavingMfaReset(true);
      setError(null);
      await userService.adminResetMfa(resetMfaUser.id);
      setResetMfaUser(null);
      await fetchData();
    } catch (err: unknown) {
      const detail = getErrorDetail(err);
      setError(detail || 'Unable to reset MFA. Try again.');
    } finally {
      setSavingMfaReset(false);
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
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to deactivate the member. Try again.'));
    }
  };

  const handleHardDelete = async (userId: string) => {
    try {
      setError(null);
      await userService.deleteUserWithMode(userId, true);
      setDeleteModalUser(null);
      await fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to permanently delete the member. Try again.'));
    }
  };

  const resetPasswordChecks = validatePasswordStrength(resetNewPassword).checks;

  const handleResetPassword = async () => {
    if (!resetPasswordUser) return;

    if (resetNewPassword !== resetConfirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const validation = validatePasswordStrength(resetNewPassword);
    if (!validation.isValid) {
      setError('Password does not meet every rule listed below');
      return;
    }

    try {
      setSavingReset(true);
      setError(null);
      await userService.adminResetPassword(resetPasswordUser.id, resetNewPassword, resetForceChange);
      // The dialog closing was the only sign it worked, which reads the same
      // as a dismissed dialog.
      toast.success(`Password reset for ${displayNameOf(resetPasswordUser) || resetPasswordUser.username}`);
      setResetPasswordUser(null);
      setResetNewPassword('');
      setResetConfirmPassword('');
      setResetForceChange(true);
    } catch (err: unknown) {
      const detail = getErrorDetail(err);
      setError(detail || 'Unable to reset password. Try again.');
    } finally {
      setSavingReset(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl py-8">
          <div className="flex h-64 items-center justify-center">
            <div className="text-theme-text-muted" role="status" aria-live="polite">
              Loading...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !editingRoles && !editingMembers && !editingProfile && !resetPasswordUser && !resetMfaUser) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl py-8">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
            <div className="flex">
              <div className="ml-3">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-theme-text-primary text-2xl font-bold">Member Management</h2>
            <p className="text-theme-text-muted mt-1 text-sm">Edit member details, assign roles, and reset passwords</p>
          </div>
          {canCreateMembers && (
            // This page is the admin hub's "manage" tab, so Add Member selects
            // the hub's sibling tab rather than routing anywhere new. The old
            // target, /admin/members/add, matched no route at all — only the
            // exact path /admin/members is redirected — so the button fell
            // through to the catch-all and bounced the user to the dashboard.
            <Link
              to="/members/admin?tab=add"
              className="btn-primary inline-flex shrink-0 items-center self-start rounded-md text-sm font-medium sm:self-auto"
            >
              <svg
                className="mr-2 -ml-1 h-5 w-5"
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

        {/* The position dialogs show their own error; repeating it here only
            put a second copy behind the overlay. */}
        {error && !editingRoles && !editingMembers && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* View Toggle */}
        <div className="mb-6">
          <div className="inline-flex rounded-md shadow-xs" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setViewMode('by-member')}
              className={`min-h-11 border px-4 py-2 text-sm font-medium ${
                viewMode === 'by-member'
                  ? 'z-10 border-red-800 bg-red-800 text-white'
                  : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
              } focus:ring-theme-focus-ring rounded-l-lg focus:z-10 focus:ring-2`}
            >
              View by Member
            </button>
            <button
              type="button"
              onClick={() => setViewMode('by-role')}
              className={`min-h-11 border px-4 py-2 text-sm font-medium ${
                viewMode === 'by-role'
                  ? 'z-10 border-red-800 bg-red-800 text-white'
                  : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover'
              } focus:ring-theme-focus-ring rounded-r-lg focus:z-10 focus:ring-2`}
            >
              View by Role
            </button>
          </div>
        </div>

        {/* View by Member */}
        {viewMode === 'by-member' && (
          <div className="bg-theme-surface overflow-x-auto shadow-sm backdrop-blur-xs sm:rounded-lg">
            <table
              className="rwd-table divide-theme-surface-border min-w-full divide-y"
              aria-label="Members and their roles"
            >
              <thead className="bg-theme-surface-secondary">
                <tr>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Member
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Member #
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Roles
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-theme-surface-hover">
                    <td data-label="Member" className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="bg-theme-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                          <span className="text-theme-text-secondary font-medium">
                            {(givenName(user)[0] || user.username[0] || '').toUpperCase()}
                          </span>
                        </div>
                        <div className="ml-4">
                          <div className="text-theme-text-primary text-sm font-medium">
                            {displayNameOf(user) || user.username}
                          </div>
                          <div className="text-theme-text-muted text-sm">@{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Member #" className="text-theme-text-muted px-6 py-4 text-sm whitespace-nowrap">
                      {user.membership_number || '-'}
                    </td>
                    <td data-label="Roles" className="px-6 py-4">
                      <div className="flex flex-wrap justify-end gap-1 md:justify-start">
                        {user.roles.length === 0 ? (
                          <span className="text-theme-text-muted text-sm">No roles</span>
                        ) : (
                          user.roles.map((role) => (
                            <span
                              key={role.id}
                              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                                role.is_system
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400'
                                  : 'bg-theme-surface text-theme-text-secondary'
                              }`}
                            >
                              {role.name}
                              <button
                                onClick={() => {
                                  void handleQuickRemoveRole(user, role.id);
                                }}
                                className="touch-target-phone ml-1 hover:text-red-600"
                                aria-label={`Remove ${role.name} role from ${displayNameOf(user) || user.username}`}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td data-label="Status" className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full px-2 text-xs leading-5 font-semibold ${
                          user.status === UserStatus.ACTIVE
                            ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                            : 'bg-theme-surface-secondary text-theme-text-secondary'
                        }`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td data-label="Actions" className="px-6 py-4 text-right text-sm font-medium whitespace-nowrap">
                      <div className="flex flex-wrap justify-end gap-3">
                        <button
                          onClick={() => void navigate(`/members/admin/edit/${user.id}`)}
                          className="touch-target-phone text-green-700 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleEditRoles(user)}
                          className="touch-target-phone text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          Manage Roles
                        </button>
                        {currentUser?.id !== user.id && (
                          <button
                            onClick={() => setResetPasswordUser(user)}
                            className="touch-target-phone text-yellow-700 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-300"
                          >
                            Reset Password
                          </button>
                        )}
                        {currentUser?.id !== user.id && user.mfa_enabled && (
                          <button
                            onClick={() => setResetMfaUser(user)}
                            className="touch-target-phone text-yellow-700 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-300"
                          >
                            Reset MFA
                          </button>
                        )}
                        {currentUser?.id !== user.id && (
                          <button
                            onClick={() => handleDeleteUser(user)}
                            className="touch-target-phone text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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
              const usersWithRole = users.filter((user) => user.roles.some((r) => r.id === role.id));

              return (
                <div key={role.id} className="bg-theme-surface shadow-sm backdrop-blur-xs sm:rounded-lg">
                  <div className="border-theme-surface-border border-b px-6 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-theme-text-primary text-lg font-medium">{role.name}</h3>
                          {role.is_system && (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                              System
                            </span>
                          )}
                        </div>
                        {role.description && <p className="text-theme-text-muted mt-1 text-sm">{role.description}</p>}
                        <p className="text-theme-text-muted mt-1 text-xs">
                          {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'} •{' '}
                          {usersWithRole.length} member{usersWithRole.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleEditMembers(role)}
                        className="hover:bg-theme-surface-hover touch-target-phone shrink-0 self-start rounded-md border border-blue-400 px-4 py-2 text-sm font-medium text-blue-700 hover:text-blue-800 sm:self-auto dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        Manage Members
                      </button>
                    </div>
                  </div>
                  <div className="px-6 py-4">
                    {usersWithRole.length === 0 ? (
                      <p className="text-theme-text-muted text-sm italic">No members assigned to this role</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {usersWithRole.map((user) => (
                          <div
                            key={user.id}
                            className="bg-theme-surface-secondary hover:bg-theme-surface-hover inline-flex items-center gap-2 rounded-lg px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <div className="bg-theme-surface flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                                <span className="text-theme-text-muted text-xs font-medium">
                                  {(givenName(user)[0] || user.username[0] || '').toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <div className="text-theme-text-primary text-sm font-medium">
                                  {displayNameOf(user) || user.username}
                                </div>
                                {user.membership_number && (
                                  <div className="text-theme-text-muted text-xs">#{user.membership_number}</div>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                void handleQuickRemoveUser(user.id, role);
                              }}
                              className="text-theme-text-muted touch-target-phone ml-2 hover:text-red-600"
                              aria-label={`Remove ${displayNameOf(user) || user.username} from ${role.name}`}
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
          onClose={() => {
            setEditingProfile(false);
            setProfileUser(null);
            setError(null);
          }}
          title={`Edit Information for ${profileUser?.full_name || profileUser?.username}`}
          footer={
            <>
              <button
                onClick={() => {
                  void handleSaveProfile();
                }}
                disabled={savingProfile}
                className="btn-info w-full rounded-md text-sm font-medium focus:ring-offset-(--ring-offset-bg) sm:ml-3 sm:w-auto"
              >
                {savingProfile ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => {
                  setEditingProfile(false);
                  setProfileUser(null);
                  setError(null);
                }}
                disabled={savingProfile}
                className="btn-secondary text-theme-text-secondary w-full text-sm font-medium focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) sm:w-auto"
              >
                Cancel
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Name Fields */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">First Name</label>
                <input
                  type="text"
                  value={profileForm.first_name}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, first_name: e.target.value }))}
                  className="form-input px-3 text-sm"
                  disabled={savingProfile}
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Middle Name</label>
                <input
                  type="text"
                  value={profileForm.middle_name}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, middle_name: e.target.value }))}
                  className="form-input px-3 text-sm"
                  disabled={savingProfile}
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Last Name</label>
                <input
                  type="text"
                  value={profileForm.last_name}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, last_name: e.target.value }))}
                  className="form-input px-3 text-sm"
                  disabled={savingProfile}
                />
              </div>
            </div>

            {/* Contact Fields */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Phone</label>
                <input
                  type="tel"
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="form-input px-3 text-sm"
                  disabled={savingProfile}
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Mobile</label>
                <input
                  type="tel"
                  value={profileForm.mobile}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, mobile: e.target.value }))}
                  className="form-input px-3 text-sm"
                  disabled={savingProfile}
                />
              </div>
            </div>

            {/* Department Fields */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Membership #</label>
                <input
                  type="text"
                  value={profileForm.membership_number}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, membership_number: e.target.value }))}
                  className="form-input px-3 text-sm"
                  disabled={savingProfile}
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Rank</label>
                <select
                  value={profileForm.rank}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, rank: e.target.value }))}
                  className="form-input px-3 text-sm"
                  disabled={savingProfile || profileIsAdministrative}
                >
                  <option value="">Select Rank</option>
                  {rankOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {profileIsAdministrative && (
                  <p className="text-theme-text-muted mt-1 text-[11px]">{ADMINISTRATIVE_RANK_HINT}</p>
                )}
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Station</label>
                <select
                  value={profileForm.station}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, station: e.target.value }))}
                  className="form-input px-3 text-sm"
                  disabled={savingProfile}
                >
                  <option value="">Select Station</option>
                  {availableStations.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && <div className="text-sm text-red-700 dark:text-red-400">{error}</div>}
          </div>
        </Modal>

        {/* Reset Password Modal */}
        <Modal
          isOpen={!!resetPasswordUser}
          onClose={() => {
            setResetPasswordUser(null);
            setResetNewPassword('');
            setResetConfirmPassword('');
            setError(null);
          }}
          title={`Reset Password for ${(resetPasswordUser ? displayNameOf(resetPasswordUser) : '') || resetPasswordUser?.username}`}
          footer={
            <>
              <button
                onClick={() => {
                  void handleResetPassword();
                }}
                disabled={savingReset || !resetNewPassword || resetNewPassword !== resetConfirmPassword}
                className="btn-warning w-full rounded-md text-sm font-medium focus:ring-offset-(--ring-offset-bg) sm:ml-3 sm:w-auto"
              >
                {savingReset ? 'Resetting...' : 'Reset Password'}
              </button>
              <button
                onClick={() => {
                  setResetPasswordUser(null);
                  setResetNewPassword('');
                  setResetConfirmPassword('');
                  setError(null);
                }}
                disabled={savingReset}
                className="btn-secondary text-theme-text-secondary w-full text-sm font-medium focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) sm:w-auto"
              >
                Cancel
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="reset-new-password"
                className="text-theme-text-muted mb-1 block text-xs font-medium uppercase"
              >
                New Password
              </label>
              <input
                id="reset-new-password"
                type="password"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                className="form-input bg-theme-surface-secondary px-3 text-sm"
                placeholder="Minimum 12 characters"
                disabled={savingReset}
                autoComplete="new-password"
              />
              {resetNewPassword && (
                <ul className="mt-2 space-y-1 text-xs" aria-label="Password rules">
                  {PASSWORD_CHECKLIST.map(({ key, label }) => {
                    const met = resetPasswordChecks[key];
                    return (
                      <li key={key} className={met ? 'text-green-700 dark:text-green-300' : 'text-theme-text-muted'}>
                        {met ? '✓' : '○'} {label}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <label
                htmlFor="reset-confirm-password"
                className="text-theme-text-muted mb-1 block text-xs font-medium uppercase"
              >
                Confirm Password
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                className="form-input bg-theme-surface-secondary px-3 text-sm"
                placeholder="Re-enter password"
                disabled={savingReset}
                autoComplete="new-password"
              />
              {resetConfirmPassword && resetNewPassword !== resetConfirmPassword && (
                <p className="mt-1 text-xs text-red-700 dark:text-red-400">Passwords do not match</p>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={resetForceChange}
                onChange={(e) => setResetForceChange(e.target.checked)}
                className="form-checkbox border-theme-surface-border"
                disabled={savingReset}
              />
              <span className="text-theme-text-secondary text-sm">
                Require the member to change this password at next sign-in
              </span>
            </label>

            {error && (
              <div role="alert" className="text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}
          </div>
        </Modal>

        {/* Reset MFA Modal */}
        <Modal
          isOpen={!!resetMfaUser}
          onClose={() => {
            setResetMfaUser(null);
            setError(null);
          }}
          title={`Reset MFA for ${(resetMfaUser ? displayNameOf(resetMfaUser) : '') || resetMfaUser?.username}`}
          footer={
            <>
              <button
                onClick={() => {
                  void handleResetMfa();
                }}
                disabled={savingMfaReset}
                className="btn-warning w-full rounded-md text-sm font-medium focus:ring-offset-(--ring-offset-bg) sm:ml-3 sm:w-auto"
              >
                {savingMfaReset ? 'Resetting...' : 'Reset MFA'}
              </button>
              <button
                onClick={() => {
                  setResetMfaUser(null);
                  setError(null);
                }}
                disabled={savingMfaReset}
                className="btn-secondary text-theme-text-secondary w-full text-sm font-medium focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) sm:w-auto"
              >
                Cancel
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-theme-text-secondary text-sm">
              This disables two-factor authentication and clears the member's authenticator and recovery codes. Use this
              only when the member has lost their device and recovery codes.
            </p>
            <p className="text-theme-text-secondary text-sm">
              They'll be signed out of active sessions and can re-enroll from their own Security settings. If your
              department requires MFA, they'll be prompted to set it up again at next sign-in.
            </p>
            {error && <div className="text-sm text-red-700 dark:text-red-400">{error}</div>}
          </div>
        </Modal>

        {/* Role Assignment Modal (for View by Member) */}
        <Modal
          isOpen={editingRoles && !!selectedUser}
          onClose={() => {
            setEditingRoles(false);
            setSelectedUser(null);
            setError(null);
          }}
          title={`Manage Roles for ${(selectedUser ? displayNameOf(selectedUser) : '') || selectedUser?.username}`}
          footer={
            <>
              <button
                onClick={() => {
                  void handleSaveRoles();
                }}
                disabled={saving}
                className="btn-info w-full rounded-md text-sm font-medium focus:ring-offset-(--ring-offset-bg) sm:ml-3 sm:w-auto"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => {
                  setEditingRoles(false);
                  setSelectedUser(null);
                  setError(null);
                }}
                disabled={saving}
                className="btn-secondary text-theme-text-secondary w-full text-sm font-medium focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) sm:w-auto"
              >
                Cancel
              </button>
            </>
          }
        >
          <p className="text-theme-text-muted mb-4 text-sm">Select the roles to assign to this member</p>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            {roles.map((role) => (
              <label
                key={role.id}
                className="hover:bg-theme-surface-hover flex cursor-pointer items-start rounded-lg p-3"
              >
                <input
                  type="checkbox"
                  checked={selectedRoleIds.includes(role.id)}
                  onChange={() => handleToggleRole(role.id)}
                  className="form-checkbox border-theme-surface-border mt-1"
                />
                <div className="ml-3">
                  <div className="flex items-center gap-2">
                    <span className="text-theme-text-primary text-sm font-medium">{role.name}</span>
                    {role.is_system && (
                      <span className="rounded-sm bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                        System
                      </span>
                    )}
                  </div>
                  {role.description && <p className="text-theme-text-muted mt-1 text-xs">{role.description}</p>}
                </div>
              </label>
            ))}
          </div>
        </Modal>

        {/* Member Assignment Modal (for View by Role) */}
        <Modal
          isOpen={editingMembers && !!selectedRole}
          onClose={() => {
            setEditingMembers(false);
            setSelectedRole(null);
            setError(null);
          }}
          title={`Manage Members for ${selectedRole?.name}`}
          footer={
            <>
              <button
                onClick={() => {
                  void handleSaveMembers();
                }}
                disabled={saving}
                className="btn-info w-full rounded-md text-sm font-medium focus:ring-offset-(--ring-offset-bg) sm:ml-3 sm:w-auto"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => {
                  setEditingMembers(false);
                  setSelectedRole(null);
                  setError(null);
                }}
                disabled={saving}
                className="btn-secondary text-theme-text-secondary w-full text-sm font-medium focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) sm:w-auto"
              >
                Cancel
              </button>
            </>
          }
        >
          <p className="text-theme-text-muted mb-4 text-sm">Select the members to assign to this role</p>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            {users.map((user) => (
              <label
                key={user.id}
                className="hover:bg-theme-surface-hover flex cursor-pointer items-start rounded-lg p-3"
              >
                <input
                  type="checkbox"
                  checked={selectedUserIds.includes(user.id)}
                  onChange={() => handleToggleUser(user.id)}
                  className="form-checkbox border-theme-surface-border mt-1"
                />
                <div className="ml-3 flex items-center gap-2">
                  <div className="bg-theme-surface flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                    <span className="text-theme-text-muted text-xs font-medium">
                      {(givenName(user)[0] || user.username[0] || '').toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="text-theme-text-primary text-sm font-medium">
                      {displayNameOf(user) || user.username}
                    </div>
                    <div className="text-theme-text-muted text-xs">
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
