/**
 * Members Admin Page
 *
 * Administrative page for managing members' positions, permissions, and
 * contact information.
 * Accessible to: IT Administrator, Chief, Assistant Chief, President,
 * Vice President, Secretary, Assistant Secretary
 *
 * Features:
 * - View by Member: See each member, their rank, membership type and positions
 * - View by Position: See each position and the members assigned to it
 * - Edit member contact information (admin)
 *
 * A member record carries four separate classifications, and three of them
 * use the word "probationary" to mean different things. This page names all
 * four so an officer can tell which one they are looking at:
 * - Positions (the Roles page): the offices held, and the main source of
 *   permissions. Every member holds the base Member position. The seeded
 *   positions that mirror a rank (Chief, Captain, Firefighter, ...) are not
 *   offered or shown here — a rank is set in the Rank field — except that one
 *   a member already holds stays in Manage Positions so it can be taken off.
 * - Rank: the operational rank, with a few default permissions of its own.
 * - Member class: operational, administrative or social. No permissions.
 * - Membership status: the ladder standing — probationary, regular, life, or
 *   one of the department's own tiers. No permissions; the tier ladder
 *   advances it by years of service, and any class can hold any standing.
 * - Status: the account lifecycle — active, on leave, retired, dropped —
 *   changed from the member's profile.
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
import { isCommittee, mirrorsRank, withoutRankMirrors } from '../utils/positions';
import { Modal } from '../components/Modal';
import { DeleteMemberModal } from '../components/DeleteMemberModal';
import { useRanks } from '../hooks/useRanks';
import { UserStatus } from '../constants/enums';
import { useConfirm } from '../contexts/ConfirmContext';
import {
  ADMINISTRATIVE_RANK_HINT,
  effectiveMemberClass,
  isAdministrativeMember,
  memberClassLabel,
  memberStatusLabel,
  membershipTypeLabel,
} from '../utils/membership';
import { useTimezone } from '../hooks/useTimezone';
import { OverduePropertyReturnsPanel } from '../components/members/OverduePropertyReturnsPanel';
import { formatDate, formatTime } from '../utils/dateFormatting';
import type { PasskeyInfo } from '../types/auth';
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

/**
 * "Administrative · Life member", or the legacy label for a row written before
 * the pair existed. The class is omitted when it only repeats the status.
 */
function membershipSummary(user: {
  member_class?: string | null | undefined;
  member_status?: string | null | undefined;
  membership_type?: string | undefined;
}): string {
  const cls = memberClassLabel(effectiveMemberClass(user.member_class, user.membership_type));
  const status = user.member_status ? memberStatusLabel(user.member_status) : '';
  if (!status) return cls || membershipTypeLabel(user.membership_type) || '-';
  return cls ? `${cls} · ${status} member` : `${status} member`;
}

export const MembersAdminPage: React.FC = () => {
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const { checkPermission, user: currentUser } = useAuthStore();
  const { rankOptions, formatRank } = useRanks();
  const tz = useTimezone();
  const [unlockingUserId, setUnlockingUserId] = useState<string | null>(null);
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
  // The member's passkeys, so one lost phone can be removed without resetting
  // everything. Null while loading or when the list could not be read.
  const [mfaUserPasskeys, setMfaUserPasskeys] = useState<PasskeyInfo[] | null>(null);
  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);

  // Delete modal state
  const [deleteModalUser, setDeleteModalUser] = useState<UserWithRoles | null>(null);

  // Station lookup
  const [availableStations, setAvailableStations] = useState<Location[]>([]);

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
        setError(detail || 'Unable to save position assignments. Try again.');
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

  // W11-9: the server refuses to take the base Member position off anyone who
  // is not archived — it carries the baseline access every member needs. The
  // controls that would only earn that refusal are not offered.
  const isLockedBasePosition = (user: Pick<UserWithRoles, 'status'>, role: Pick<Role, 'slug'>) =>
    role.slug === 'member' && user.status !== UserStatus.ARCHIVED;

  // The seeded mirror of a rank is not something to hand out — the Rank field
  // is — but one a member already holds stays listed so it can be taken off.
  // Hidden assignments survive a save untouched: `selectedRoleIds` starts from
  // every position the member holds, and only the offered ones can be toggled.
  // Offices first, then committees, each in the server's priority order, so
  // the dialog reads as two lists rather than one with committees scattered
  // through it.
  const offeredPositions = roles
    .filter((role) => !mirrorsRank(role) || !!selectedUser?.roles.some((held) => held.id === role.id))
    .sort((a, b) => Number(isCommittee(a)) - Number(isCommittee(b)));

  const handleToggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]));
  };

  const handleToggleUser = (userId: string) => {
    setSelectedUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const handleQuickRemoveRole = async (user: UserWithRoles, roleId: string) => {
    const roleName = user.roles.find((r) => r.id === roleId)?.name ?? 'this position';
    if (
      !(await confirm({
        title: 'Remove position',
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
      setError(getErrorDetail(err) || 'Unable to remove the position. Check your connection and try again.');
    }
  };

  const handleQuickRemoveUser = async (userId: string, role: Role) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    if (
      !(await confirm({
        title: 'Remove from position',
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
        getErrorDetail(err) || 'Unable to remove the member from this position. Check your connection and try again.'
      );
    }
  };

  const handleUnlock = async (user: UserWithRoles) => {
    try {
      setUnlockingUserId(user.id);
      setError(null);
      await userService.adminUnlockAccount(user.id);
      toast.success(`${user.full_name || user.username} can sign in again`);
      await fetchData();
    } catch (err: unknown) {
      setError(getErrorDetail(err) || 'Unable to unlock this account. Try again.');
    } finally {
      setUnlockingUserId(null);
    }
  };

  useEffect(() => {
    if (!resetMfaUser) {
      setMfaUserPasskeys(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const passkeys = await userService.adminListPasskeys(resetMfaUser.id);
        if (!cancelled) setMfaUserPasskeys(passkeys);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, "Unable to load the member's passkeys."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resetMfaUser]);

  const handleRemovePasskey = async (passkey: PasskeyInfo) => {
    if (!resetMfaUser) return;
    const ok = await confirm({
      title: 'Remove passkey',
      message: `Remove "${passkey.name}" from ${displayNameOf(resetMfaUser) || resetMfaUser.username}'s account? They will be signed out everywhere. Their other sign-in methods keep working.`,
      confirmLabel: 'Remove passkey',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      setRemovingPasskeyId(passkey.id);
      setError(null);
      await userService.adminRemovePasskey(resetMfaUser.id, passkey.id);
      setMfaUserPasskeys((prev) => (prev ?? []).filter((p) => p.id !== passkey.id));
      toast.success('Passkey removed');
      await fetchData();
    } catch (err: unknown) {
      setError(getErrorDetail(err) || 'Unable to remove the passkey. Try again.');
    } finally {
      setRemovingPasskeyId(null);
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
        {/* The hub's section nav already names this page, and its header carries
           the one red Add Member action; a second here broke the frame's
           one-primary rule. The title stays for heading navigation only. */}
        <h2 className="sr-only">Member Management</h2>

        {/* Former members still holding property (member lifecycle): the
            same panel the Inventory Member Equipment page shows. */}
        {checkPermission('members.manage') && <OverduePropertyReturnsPanel tz={tz} />}

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
              View by Position
            </button>
          </div>
        </div>

        <p className="text-theme-text-muted mb-4 text-sm">
          Each member has a <strong>rank</strong> (their place in the chain of command), a{' '}
          <strong>membership type</strong> (probationary, active, life or administrative, which the Membership Tiers
          ladder advances) and one or more <strong>positions</strong> (the offices held, managed under Roles, which
          decide what they can do). Every member holds the base Member position. Positions named after a rank &mdash;
          Chief, Captain, Firefighter &mdash; are not listed here: a rank is set in the Rank field and carries its own
          access. A member&rsquo;s account <strong>status</strong> &mdash; on leave, retired, dropped &mdash; is changed
          from their profile.
        </p>

        {/* View by Member */}
        {viewMode === 'by-member' && (
          // A named, focusable scroll region: on a tablet the table is wider
          // than its card, and with no member rows yet nothing inside it can
          // take focus, so a keyboard could not scroll to the cut-off columns
          // (axe scrollable-region-focusable).
          <div
            className="bg-theme-surface overflow-x-auto shadow-sm backdrop-blur-xs sm:rounded-lg"
            role="region"
            aria-label="Members and their positions"
            tabIndex={0}
            data-mobile-scroll-region
          >
            <table
              className="rwd-table divide-theme-surface-border min-w-full divide-y"
              aria-label="Members and their positions"
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
                    Rank
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Membership
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-muted px-6 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Positions
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
                          <Link
                            to={`/members/${user.id}`}
                            className="text-theme-text-primary text-sm font-medium hover:underline"
                          >
                            {displayNameOf(user) || user.username}
                          </Link>
                          <div className="text-theme-text-muted text-sm">@{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Member #" className="text-theme-text-muted px-6 py-4 text-sm whitespace-nowrap">
                      {user.membership_number || '-'}
                    </td>
                    <td data-label="Rank" className="text-theme-text-secondary px-6 py-4 text-sm whitespace-nowrap">
                      {formatRank(user.rank) || '-'}
                    </td>
                    <td
                      data-label="Membership"
                      className="text-theme-text-secondary px-6 py-4 text-sm whitespace-nowrap"
                    >
                      {membershipSummary(user)}
                    </td>
                    <td data-label="Positions" className="px-6 py-4">
                      <div className="flex flex-wrap justify-end gap-1 md:justify-start">
                        {withoutRankMirrors(user.roles).length === 0 ? (
                          <span className="text-theme-text-muted text-sm">No positions</span>
                        ) : (
                          withoutRankMirrors(user.roles).map((role) => (
                            <span
                              key={role.id}
                              data-kind={isCommittee(role) ? 'committee' : 'office'}
                              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                                isCommittee(role)
                                  ? 'bg-teal-100 text-teal-900 dark:bg-teal-500/20 dark:text-teal-300'
                                  : role.is_system
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400'
                                    : 'bg-theme-surface text-theme-text-secondary'
                              }`}
                            >
                              {role.name}
                              {!isLockedBasePosition(user, role) && (
                                <button
                                  onClick={() => {
                                    void handleQuickRemoveRole(user, role.id);
                                  }}
                                  className="touch-target-phone ml-1 hover:text-red-600"
                                  aria-label={`Remove ${role.name} position from ${displayNameOf(user) || user.username}`}
                                >
                                  ×
                                </button>
                              )}
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
                      {user.locked_until && (
                        <span className="mt-1 block text-xs font-semibold text-red-700 dark:text-red-400">
                          Sign-in locked until {formatTime(user.locked_until, tz)}
                        </span>
                      )}
                    </td>
                    <td data-label="Actions" className="px-6 py-4 text-right text-sm font-medium whitespace-nowrap">
                      <div className="flex flex-wrap justify-end gap-3">
                        <button
                          onClick={() => void navigate(`/members/admin/edit/${user.id}`)}
                          aria-label={`Edit ${displayNameOf(user) || user.username}`}
                          className="touch-target-phone text-green-700 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleEditRoles(user)}
                          aria-label={`Manage positions for ${displayNameOf(user) || user.username}`}
                          className="touch-target-phone text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          Manage Positions
                        </button>
                        {currentUser?.id !== user.id && (
                          <button
                            onClick={() => setResetPasswordUser(user)}
                            aria-label={`Reset password for ${displayNameOf(user) || user.username}`}
                            className="touch-target-phone text-yellow-700 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-300"
                          >
                            Reset Password
                          </button>
                        )}
                        {currentUser?.id !== user.id && user.locked_until && (
                          <button
                            onClick={() => void handleUnlock(user)}
                            aria-label={`Unlock ${displayNameOf(user) || user.username}`}
                            disabled={unlockingUserId === user.id}
                            className="touch-target-phone text-yellow-700 hover:text-yellow-800 disabled:opacity-50 dark:text-yellow-400 dark:hover:text-yellow-300"
                          >
                            {unlockingUserId === user.id ? 'Unlocking…' : 'Unlock'}
                          </button>
                        )}
                        {currentUser?.id !== user.id && (user.mfa_enabled || user.has_passkey) && (
                          <button
                            onClick={() => setResetMfaUser(user)}
                            aria-label={`Reset MFA for ${displayNameOf(user) || user.username}`}
                            className="touch-target-phone text-yellow-700 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-300"
                          >
                            Reset MFA
                          </button>
                        )}
                        {currentUser?.id !== user.id && (
                          <button
                            onClick={() => handleDeleteUser(user)}
                            aria-label={`Delete ${displayNameOf(user) || user.username}`}
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

        {/* View by Position */}
        {viewMode === 'by-role' && (
          <div className="space-y-4">
            {withoutRankMirrors(roles).map((role) => {
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
                          {isCommittee(role) && (
                            <span className="inline-flex items-center rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-900 dark:bg-teal-500/20 dark:text-teal-300">
                              Committee
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
                      <p className="text-theme-text-muted text-sm italic">No members assigned to this position</p>
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
                                <Link
                                  to={`/members/${user.id}`}
                                  className="text-theme-text-primary text-sm font-medium hover:underline"
                                >
                                  {displayNameOf(user) || user.username}
                                </Link>
                                {user.membership_number && (
                                  <div className="text-theme-text-muted text-xs">#{user.membership_number}</div>
                                )}
                              </div>
                            </div>
                            {!isLockedBasePosition(user, role) && (
                              <button
                                onClick={() => {
                                  void handleQuickRemoveUser(user.id, role);
                                }}
                                className="text-theme-text-muted touch-target-phone ml-2 hover:text-red-600"
                                aria-label={`Remove ${displayNameOf(user) || user.username} from ${role.name}`}
                              >
                                ×
                              </button>
                            )}
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
            {mfaUserPasskeys && mfaUserPasskeys.length > 0 && (
              <div className="space-y-2">
                <p className="text-theme-text-primary text-sm font-medium">Passkeys</p>
                <p className="text-theme-text-secondary text-sm">
                  Lost one phone? Remove just that passkey. The member keeps their other sign-in methods.
                </p>
                <ul className="divide-theme-surface-border border-theme-surface-border divide-y rounded-lg border">
                  {mfaUserPasskeys.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-theme-text-primary truncate text-sm">{p.name}</p>
                        <p className="text-theme-text-muted text-xs">
                          Added {formatDate(p.created_at, tz)}
                          {p.last_used_at ? ` · Last used ${formatDate(p.last_used_at, tz)}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRemovePasskey(p)}
                        disabled={removingPasskeyId !== null || savingMfaReset}
                        aria-label={`Remove passkey ${p.name}`}
                        className="touch-target-phone text-sm text-red-700 hover:text-red-800 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                      >
                        {removingPasskeyId === p.id ? 'Removing…' : 'Remove'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-theme-text-secondary text-sm">
              Reset MFA turns off two-factor authentication completely: it removes the member's authenticator, every
              passkey and their recovery codes. Use it only when the member has lost all their devices and recovery
              codes.
            </p>
            <p className="text-theme-text-secondary text-sm">
              They'll be signed out of active sessions and can re-enroll from their own Security settings. If your
              department requires MFA, they'll be prompted to set it up again at next sign-in.
            </p>
            {error && <div className="text-sm text-red-700 dark:text-red-400">{error}</div>}
          </div>
        </Modal>

        {/* Position Assignment Modal (for View by Member) */}
        <Modal
          isOpen={editingRoles && !!selectedUser}
          onClose={() => {
            setEditingRoles(false);
            setSelectedUser(null);
            setError(null);
          }}
          title={`Manage Positions for ${(selectedUser ? displayNameOf(selectedUser) : '') || selectedUser?.username}`}
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
          <p className="text-theme-text-muted mb-4 text-sm">
            Select the positions to assign to this member. A rank is set from the member&rsquo;s profile, not here.
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            {offeredPositions.map((role) => (
              <label
                key={role.id}
                className="hover:bg-theme-surface-hover flex cursor-pointer items-start rounded-lg p-3"
              >
                <input
                  type="checkbox"
                  checked={selectedRoleIds.includes(role.id)}
                  onChange={() => handleToggleRole(role.id)}
                  // Held and locked: it stays ticked. Not held (a member who
                  // somehow lacks it) can still be given it back.
                  disabled={
                    !!selectedUser &&
                    isLockedBasePosition(selectedUser, role) &&
                    selectedUser.roles.some((r) => r.id === role.id)
                  }
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
                    {mirrorsRank(role) && (
                      <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-500/20 dark:text-amber-300">
                        Rank
                      </span>
                    )}
                    {isCommittee(role) && (
                      <span className="rounded-sm bg-teal-100 px-2 py-0.5 text-xs text-teal-900 dark:bg-teal-500/20 dark:text-teal-300">
                        Committee
                      </span>
                    )}
                  </div>
                  {mirrorsRank(role) ? (
                    <p className="text-theme-text-muted mt-1 text-xs">
                      Duplicates the {role.name} rank, which already grants this access. Untick to remove it; it is not
                      offered to members who do not hold it.
                    </p>
                  ) : (
                    role.description && <p className="text-theme-text-muted mt-1 text-xs">{role.description}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        </Modal>

        {/* Member Assignment Modal (for View by Position) */}
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
          <p className="text-theme-text-muted mb-4 text-sm">Select the members to assign to this position</p>

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
                  disabled={
                    !!selectedRole &&
                    isLockedBasePosition(user, selectedRole) &&
                    user.roles.some((r) => r.id === selectedRole.id)
                  }
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
