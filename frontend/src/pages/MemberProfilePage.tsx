/**
 * Member Profile Page
 *
 * Comprehensive view of a member's information including:
 * - Basic information
 * - Current month hours
 * - Upcoming shifts
 * - Training records
 * - Assigned inventory items
 * - Apparatus certifications
 * - Contact information
 * - Roles and permissions
 *
 * Module sections are conditionally rendered based on AVAILABLE_MODULES.
 */

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import {
  userService,
  organizationService,
  trainingService,
  inventoryService,
  memberStatusService,
} from '../services/api';
import { adminHoursEntryService, adminHoursComplianceService } from '../modules/admin-hours/services/api';
import type { AdminHoursComplianceItem } from '../modules/admin-hours/types';
import type { AdminHoursSummary } from '../modules/admin-hours/types';
import type { LeaveOfAbsenceResponse } from '../services/api';
import { CreditCard, Pencil } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { useRanks } from '../hooks/useRanks';
import { useProfileVisibility } from '../hooks/useProfileVisibility';
import { useConnectedIntegrations } from '../hooks/useConnectedIntegrations';
import { NFC_ID_CARDS_INTEGRATION } from '../modules/membership/constants/idCards';
import { formatCalendarDate, formatDate } from '../utils/dateFormatting';
import { formatHours, sumHoursToQuarter } from '../utils/hoursFormatting';
import { isAdministrativeMember, membershipTypeLabel } from '../utils/membership';
import type { UserWithRoles } from '../types/role';
import type {
  ContactInfoSettings,
  ContactInfoUpdate,
  NotificationPreferences,
  EmergencyContact,
  UserProfileUpdate,
} from '../types/user';
import type { TrainingRecord, ComplianceSummary } from '../types/training';
import { AVAILABLE_MODULES } from '../types/modules';
import { MAX_AVATAR_SIZE } from '../constants/config';
import { UserStatus } from '../constants/enums';
import TrainingSection from '../components/member-profile/TrainingSection';
import AdminHoursSection from '../components/member-profile/AdminHoursSection';
import ContactInfoSection from '../components/member-profile/ContactInfoSection';
import EmergencyContactsSection from '../components/member-profile/EmergencyContactsSection';
import { VisibilityControl } from '../components/member-profile/VisibilityControl';
import { useOverlaySurface } from '../hooks/useOverlaySurface';
import { MemberIdCardsPanel } from '../modules/membership/components/MemberIdCardsPanel';

// Types for inventory data
interface InventoryItem {
  id: string;
  name: string;
  item_number: string;
  category: string;
  condition: string;
  assigned_date: string;
}

/** Check if a module is enabled by its id. */
function isModuleEnabled(moduleId: string): boolean {
  const mod = AVAILABLE_MODULES.find((m) => m.id === moduleId);
  return mod?.enabled ?? false;
}

function isExpiringSoon(record: TrainingRecord): boolean {
  if (!record.expiration_date) return false;
  const expDate = new Date(record.expiration_date);
  const now = new Date();
  const daysUntilExpiry = (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry > 0 && daysUntilExpiry <= 90;
}

function isExpired(record: TrainingRecord): boolean {
  if (!record.expiration_date) return false;
  return new Date(record.expiration_date) < new Date();
}

export const MemberProfilePage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user: currentUser, checkPermission } = useAuthStore();
  const tz = useTimezone();

  const [user, setUser] = useState<UserWithRoles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventoryModuleEnabled, setInventoryModuleEnabled] = useState(false);

  // Edit mode states
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // null = not loaded / unreadable, so the UI claims nothing either way.
  const [smsConsentGranted, setSmsConsentGranted] = useState<boolean | null>(null);
  const [editForm, setEditForm] = useState<ContactInfoUpdate>({
    email: '',
    phone: '',
    mobile: '',
    notification_preferences: {
      email_notifications: true,
      sms_notifications: true,
      event_reminders: true,
      training_reminders: true,
    },
  });

  // Photo upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Address edit state
  const [editingAddress, setEditingAddress] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressForm, setAddressForm] = useState({
    address_street: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    address_country: 'USA',
    personal_email: '',
  });

  // Emergency contacts edit state
  const [editingContacts, setEditingContacts] = useState(false);
  const [savingContacts, setSavingContacts] = useState(false);
  const [contactsForm, setContactsForm] = useState<EmergencyContact[]>([]);

  // Module data states
  const [trainings, setTrainings] = useState<TrainingRecord[]>([]);
  const [trainingsLoading, setTrainingsLoading] = useState(false);
  const [complianceSummary, setComplianceSummary] = useState<ComplianceSummary | null>(null);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [activeLeaves, setActiveLeaves] = useState<LeaveOfAbsenceResponse[]>([]);
  const [adminHoursSummary, setAdminHoursSummary] = useState<AdminHoursSummary | null>(null);
  const [adminHoursLoading, setAdminHoursLoading] = useState(false);
  const [adminHoursCompliance, setAdminHoursCompliance] = useState<AdminHoursComplianceItem[]>([]);

  // Status change modal state
  const [statusModalOpen, setStatusModalOpen] = useState(false);

  // Takes the fixed mobile bottom bar off this overlay while it is open.
  useOverlaySurface(statusModalOpen);
  const [statusChanging, setStatusChanging] = useState(false);
  const [newStatus, setNewStatus] = useState<string>('');
  const [statusReason, setStatusReason] = useState('');

  // Module enablement checks
  const trainingEnabled = isModuleEnabled('training');

  const fetchInventoryItems = React.useCallback(async (uid: string) => {
    try {
      setInventoryLoading(true);
      const response = await inventoryService.getUserInventory(uid);
      // Transform the inventory response to match our InventoryItem interface
      const items: InventoryItem[] = (response?.permanent_assignments ?? []).map((item) => ({
        id: item.assignment_id,
        name: item.item_name,
        item_number: item.serial_number || item.asset_tag || '',
        category: 'Equipment', // Category not in response, using default
        condition: item.condition,
        assigned_date: item.assigned_date,
      }));
      setInventoryItems(items);
    } catch (_err) {
      // Don't set error - show empty state
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  const fetchModuleStatus = React.useCallback(async () => {
    try {
      const response = await organizationService.getEnabledModules();
      setInventoryModuleEnabled((response?.enabled_modules ?? []).includes('inventory'));
    } catch (_err) {
      // If we can't fetch module status, default to not showing inventory
      setInventoryModuleEnabled(false);
    }
  }, []);

  const fetchUserData = React.useCallback(async (uid: string) => {
    try {
      setLoading(true);
      setError(null);
      const userData = await userService.getUserWithRoles(uid);
      setUser(userData);
    } catch (_err) {
      setError('Unable to load member information. The member may not exist or you may not have access.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTrainingRecords = React.useCallback(async (uid: string) => {
    try {
      setTrainingsLoading(true);
      const records = await trainingService.getRecords({ user_id: uid });
      setTrainings(records);
    } catch (_err) {
      // Don't set error - show empty state
    } finally {
      setTrainingsLoading(false);
    }
  }, []);

  const fetchComplianceSummary = React.useCallback(async (uid: string) => {
    try {
      const summary = await trainingService.getComplianceSummary(uid);
      setComplianceSummary(summary);
    } catch (_err) {
      // Don't set error - compliance summary is optional
    }
  }, []);

  const fetchLeaves = React.useCallback(async (uid: string) => {
    try {
      const data = await memberStatusService.getMemberLeaves(uid);
      setActiveLeaves(data);
    } catch {
      // Don't set error - show empty state
    }
  }, []);

  const fetchAdminHours = React.useCallback(async (uid: string) => {
    try {
      setAdminHoursLoading(true);
      const [summary, compliance] = await Promise.all([
        adminHoursEntryService.getSummary({ userId: uid }),
        adminHoursComplianceService.getUserCompliance(uid).catch(() => [] as AdminHoursComplianceItem[]),
      ]);
      setAdminHoursSummary(summary);
      setAdminHoursCompliance(compliance);
    } catch {
      // Don't set error - admin hours section is optional
    } finally {
      setAdminHoursLoading(false);
    }
  }, []);

  // The training-records and admin-hours APIs silently substitute the
  // CALLER's id for non-managers, so fetching them for a colleague would
  // render the VIEWER's own records and hours as the colleague's. Only
  // fetch (and render) these sections for self, or for holders of the
  // permission the backend honors for target-scoped reads.
  const isSelf = currentUser?.id === userId;
  const canViewTargetTraining = isSelf || checkPermission('training.manage');
  const canViewTargetAdminHours = isSelf || checkPermission('admin_hours.manage');
  // Which gear a colleague signed for is quartermaster business, not part of
  // the contact card every member may look up. inventory.view is baseline for
  // every member (it opens the catalog and their own kit), so it cannot be the
  // gate here — inventory.manage is.
  const canViewTargetInventory = isSelf || checkPermission('inventory.manage');

  useEffect(() => {
    if (userId) {
      void fetchUserData(userId);
      void fetchModuleStatus();
      void fetchLeaves(userId);
      if (canViewTargetAdminHours) {
        void fetchAdminHours(userId);
      }
      if (trainingEnabled && canViewTargetTraining) {
        void fetchTrainingRecords(userId);
        void fetchComplianceSummary(userId);
      }
    }
  }, [
    userId,
    trainingEnabled,
    canViewTargetTraining,
    canViewTargetAdminHours,
    fetchUserData,
    fetchModuleStatus,
    fetchLeaves,
    fetchAdminHours,
    fetchTrainingRecords,
    fetchComplianceSummary,
  ]);

  useEffect(() => {
    if (userId && inventoryModuleEnabled && canViewTargetInventory) {
      void fetchInventoryItems(userId);
    } else {
      // Navigating from a profile we could see gear on to one we cannot must
      // not leave the previous member's items in state.
      setInventoryItems([]);
    }
  }, [userId, inventoryModuleEnabled, canViewTargetInventory, fetchInventoryItems]);

  const canManageMembers = checkPermission('members.manage');

  // Rank codes are stored on the member; the display name lives on the org's
  // operational ranks, readable by any signed-in member.
  const { formatRank } = useRanks();

  // The member's own choice of what colleagues see. Seeded from the profile
  // payload (present for self and for members-managers) so no second request
  // is made; owned by the hook so a contact-info save replacing `user` cannot
  // reset a switch mid-flight.
  const privacy = useProfileVisibility({ enabled: isSelf, initial: user?.profile_visibility });

  // The department's own contact-visibility ceiling. A marker that says
  // "Visible to members" while the department has switched work email off
  // for everyone would promise a visibility the roster does not give, so the
  // markers combine the two. Only the member and members-managers see
  // markers, so only they need the setting.
  const [orgContactVisibility, setOrgContactVisibility] = useState<ContactInfoSettings | null>(null);
  const needsOrgVisibility = isSelf || canManageMembers;
  useEffect(() => {
    if (!needsOrgVisibility) return;
    let cancelled = false;
    userService
      .checkContactInfoEnabled()
      .then((settings) => {
        if (!cancelled) setOrgContactVisibility(settings);
      })
      .catch(() => {
        // Unknown rather than assumed: the markers then show the member's
        // own choice alone, which is what they control.
        if (!cancelled) setOrgContactVisibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [needsOrgVisibility]);

  // MemberIdCardsPanel renders nothing until the NFC ID Cards integration is
  // known to be connected, so the layout must not reserve a column for it
  // on that basis alone.
  const { isConnected: isIntegrationConnected, loading: integrationsLoading } = useConnectedIntegrations();
  const idCardsEnabled = !integrationsLoading && isIntegrationConnected(NFC_ID_CARDS_INTEGRATION);

  const handleOpenStatusModal = () => {
    if (!user) return;
    setNewStatus(user.status);
    setStatusReason('');
    setStatusModalOpen(true);
  };

  const handleStatusChange = async () => {
    if (!userId || !newStatus || !user) return;
    if (newStatus === user.status) return;

    try {
      setStatusChanging(true);
      setError(null);
      await memberStatusService.changeStatus(userId, {
        new_status: newStatus,
        reason: statusReason.trim() || undefined,
      });
      // Re-fetch user to get the updated status
      await fetchUserData(userId);
      setStatusModalOpen(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to change member status. Please try again.'));
    } finally {
      setStatusChanging(false);
    }
  };

  const handleEditClick = () => {
    // The SMS preference in this form is meaningless without the member's own
    // consent, so load it alongside. Read-only: staff can see the consent and
    // mute a consenting member, but cannot grant consent on their behalf.
    if (userId) {
      userService
        .getUserConsents(userId)
        .then((items) => {
          const sms = items.find((c) => c.consent_type === 'sms_notifications');
          setSmsConsentGranted(sms?.granted === true);
        })
        .catch(() => {
          // Unknown rather than assumed: leaving it null keeps the checkbox
          // disabled and shows no claim about what the member agreed to.
          setSmsConsentGranted(null);
        });
    }
    setEditForm({
      email: user?.email || '',
      phone: user?.phone || '',
      mobile: user?.mobile || '',
      notification_preferences: user?.notification_preferences || {
        email_notifications: true,
        sms_notifications: true,
        event_reminders: true,
        training_reminders: true,
      },
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleSaveContact = async () => {
    if (!user || !userId) return;

    try {
      setSaving(true);
      setError(null);

      // Strip empty strings to undefined so Pydantic doesn't reject '' as an invalid EmailStr
      const payload: ContactInfoUpdate = {
        email: editForm.email?.trim() || undefined,
        phone: editForm.phone?.trim() || undefined,
        mobile: editForm.mobile?.trim() || undefined,
        notification_preferences: editForm.notification_preferences,
      };

      const updatedUser = await userService.updateContactInfo(userId, payload);
      setUser(updatedUser);
      setIsEditing(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to update contact information. Please check your input and try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleFormChange = (field: keyof ContactInfoUpdate, value: string) => {
    setEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleNotificationToggle = (type: keyof NotificationPreferences) => {
    setEditForm((prev) => {
      const currentPrefs = prev.notification_preferences ?? {
        email_notifications: true,
        sms_notifications: true,
        event_reminders: true,
        training_reminders: true,
      };
      return {
        ...prev,
        notification_preferences: {
          ...currentPrefs,
          [type]: !currentPrefs[type],
        },
      };
    });
  };

  // Photo upload handlers
  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    // Client-side validation
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Please select a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setError('Image must be under 5MB.');
      return;
    }

    try {
      setUploadingPhoto(true);
      setError(null);
      const result = await userService.uploadPhoto(userId, file);
      setUser((prev) => (prev ? { ...prev, photo_url: result.photo_url } : prev));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to upload photo.'));
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePhotoRemove = async () => {
    if (!userId) return;
    try {
      setUploadingPhoto(true);
      setError(null);
      await userService.deletePhoto(userId);
      setUser((prev) => (prev ? { ...prev, photo_url: undefined } : prev));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to remove photo.'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Address edit handlers
  const handleEditAddress = () => {
    setAddressForm({
      address_street: user?.address_street || '',
      address_city: user?.address_city || '',
      address_state: user?.address_state || '',
      address_zip: user?.address_zip || '',
      address_country: user?.address_country || 'USA',
      personal_email: user?.personal_email || '',
    });
    setEditingAddress(true);
  };

  const handleSaveAddress = async () => {
    if (!user || !userId) return;
    try {
      setSavingAddress(true);
      setError(null);
      const updateData: UserProfileUpdate = {
        address_street: addressForm.address_street || undefined,
        address_city: addressForm.address_city || undefined,
        address_state: addressForm.address_state || undefined,
        address_zip: addressForm.address_zip || undefined,
        address_country: addressForm.address_country || undefined,
        personal_email: addressForm.personal_email || undefined,
      };
      const updated = await userService.updateUserProfile(userId, updateData);
      setUser(updated);
      setEditingAddress(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to update address.'));
    } finally {
      setSavingAddress(false);
    }
  };

  // Emergency contacts handlers
  const handleEditEmergencyContacts = () => {
    setContactsForm(
      user?.emergency_contacts?.length
        ? user.emergency_contacts.map((ec) => ({ ...ec }))
        : [
            {
              name: '',
              relationship: '',
              phone: '',
              email: '',
              is_primary: true,
            },
          ]
    );
    setEditingContacts(true);
  };

  const handleAddContact = () => {
    setContactsForm((prev) => [...prev, { name: '', relationship: '', phone: '', email: '', is_primary: false }]);
  };

  const handleRemoveContact = (index: number) => {
    setContactsForm((prev) => prev.filter((_, i) => i !== index));
  };

  const handleContactChange = (index: number, field: keyof EmergencyContact, value: string | boolean) => {
    setContactsForm((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const handleSaveEmergencyContacts = async () => {
    if (!user || !userId) return;
    // Validate at least name and phone for each contact
    const valid = contactsForm.every((c) => c.name.trim() && c.phone.trim());
    if (!valid) {
      setError('Each emergency contact must have a name and phone number.');
      return;
    }
    try {
      setSavingContacts(true);
      setError(null);
      const updated = await userService.updateUserProfile(userId, {
        emergency_contacts: contactsForm,
      });
      setUser(updated);
      setEditingContacts(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to update emergency contacts.'));
    } finally {
      setSavingContacts(false);
    }
  };

  // Check if current user can edit this profile (self or admin)
  const isAdmin = checkPermission('users.update') || checkPermission('members.manage');
  const canManageIdCards = checkPermission('members.manage_id_cards');
  const canEdit = currentUser?.id === userId || isAdmin;
  // Emergency contacts are leadership-only server-side (members.manage or the
  // member themselves). Mirror that gate here so everyone else sees no section
  // at all — a rendered-but-empty section reads as "none on file", which is a
  // different and wrong statement about the member.
  const canViewRestrictedPii = canEdit;

  // Which "who can see this" marker a viewer gets. The member flips switches;
  // a members-manager sees a read-only badge (they see every field anyway,
  // and the badge answers "why can't Smith see my phone?"); nobody else sees
  // the marker at all — the backend nulls the choice object for them.
  const visibilityMode: 'toggle' | 'badge' | 'none' = isSelf
    ? 'toggle'
    : canManageMembers && user?.profile_visibility
      ? 'badge'
      : 'none';
  const visibility = visibilityMode === 'toggle' ? privacy.visibility : (user?.profile_visibility ?? null);

  // A null address on a colleague's profile is a redaction, not an absence:
  // the member has not shared it, and the backend blanked it. Rendering the
  // card with "No address on file." would state something false about them,
  // so the card is skipped. Self and leadership see the real empty state.
  // Address fields only: personal email is displayed in the contact card, and
  // a member who shares it while hiding their address must not trigger the
  // very false statement this guard exists to prevent.
  const hasAddressData = Boolean(user?.address_street || user?.address_city);
  const showAddressCard = canEdit || hasAddressData;

  // The left column is per-viewer: training, admin hours, ID cards and gear
  // are all hidden from a plain colleague, and a `lg:col-span-2` ghost would
  // still reserve two-thirds of the page for nothing.
  const showAdminHours = Boolean(adminHoursSummary && adminHoursSummary.totalEntries > 0) || adminHoursLoading;
  const showIdCards = Boolean(canManageIdCards && userId && idCardsEnabled);
  const hasLeftColumn =
    (trainingEnabled && canViewTargetTraining) ||
    showAdminHours ||
    showIdCards ||
    (inventoryModuleEnabled && canViewTargetInventory);
  const hasQuickStats =
    (trainingEnabled && canViewTargetTraining) ||
    (inventoryModuleEnabled && canViewTargetInventory) ||
    Boolean(adminHoursSummary && adminHoursSummary.totalEntries > 0);

  const rankLabel = user
    ? isAdministrativeMember(undefined, user.membership_type)
      ? 'Administrative'
      : formatRank(user.rank)
    : '';
  const memberTypeLabel = user ? membershipTypeLabel(user.membership_type) : '';
  // "Administrative · Administrative" would be the class stated twice.
  const headerSubtitle = [rankLabel, memberTypeLabel === rankLabel ? '' : memberTypeLabel].filter(Boolean).join(' · ');

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex h-64 items-center justify-center">
            <div className="text-theme-text-muted">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <p className="text-sm text-red-700 dark:text-red-400">{error || 'Member not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <p className="text-sm text-red-700 dark:text-red-400">Member not found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => void navigate('/members')}
            className="text-theme-text-muted hover:text-theme-text-secondary mb-4 flex items-center gap-1 text-sm"
          >
            &larr; Back to Members
          </button>

          <div className="card p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-4">
                {/* Profile Photo with Upload */}
                <div className="group relative">
                  {user.photo_url ? (
                    <img
                      src={user.photo_url}
                      alt={user.full_name || user.username}
                      className="h-20 w-20 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-100">
                      <span className="text-2xl font-bold text-indigo-600">
                        {(user.first_name?.[0] || user.username?.[0] || '?').toUpperCase()}
                      </span>
                    </div>
                  )}
                  {canEdit && (
                    <div className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/50 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          void handlePhotoUpload(e);
                        }}
                      />
                      {uploadingPhoto ? (
                        <span className="text-xs text-white">Uploading...</span>
                      ) : (
                        <button
                          onClick={handlePhotoClick}
                          className="text-xs font-medium text-white"
                          aria-label="Upload photo"
                        >
                          {user.photo_url ? 'Change' : 'Upload'}
                        </button>
                      )}
                    </div>
                  )}
                  {canEdit && user.photo_url && (
                    <button
                      onClick={() => {
                        void handlePhotoRemove();
                      }}
                      className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white transition-opacity hover:bg-red-800 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label="Remove photo"
                      title="Remove photo"
                    >
                      &times;
                    </button>
                  )}
                </div>
                <div>
                  <h1 className="text-theme-text-primary text-2xl font-bold sm:text-3xl">
                    {user.full_name || user.username}
                  </h1>
                  {headerSubtitle && (
                    <p className="text-theme-text-secondary mt-1 text-[15px] font-medium">{headerSubtitle}</p>
                  )}
                  <p className="text-theme-text-muted mt-1 text-sm">
                    @{user.username}
                    {user.membership_number && <> · #{user.membership_number}</>}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(user.roles || []).map((role) => (
                      <span
                        key={role.id}
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          role.is_system
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400'
                            : 'bg-theme-surface-secondary text-theme-text-secondary'
                        }`}
                      >
                        {role.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/members/${userId}/id-card`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 px-3 py-1 text-sm font-medium text-blue-600 transition hover:bg-blue-50 hover:text-blue-700 dark:border-blue-500/40 dark:text-blue-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
                >
                  <CreditCard className="h-4 w-4" />
                  ID Card
                </Link>
                {canManageMembers ? (
                  <button
                    type="button"
                    onClick={handleOpenStatusModal}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold transition hover:ring-2 hover:ring-blue-400 hover:ring-offset-1 ${
                      user.status === UserStatus.ACTIVE
                        ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                        : 'bg-theme-surface-secondary text-theme-text-secondary'
                    }`}
                    title="Change member status"
                  >
                    {user.status.replace(/_/g, ' ')}
                    <Pencil className="h-3 w-3" />
                  </button>
                ) : (
                  // The account lifecycle status is leadership's concern; a
                  // colleague only needs to know when it is NOT the ordinary
                  // case — on leave, retired, suspended.
                  user.status !== UserStatus.ACTIVE && (
                    <span className="bg-theme-surface-secondary text-theme-text-secondary rounded-full px-3 py-1 text-sm font-semibold capitalize">
                      {user.status.replace(/_/g, ' ')}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid. With nothing to show on the left, the right
            column's cards spread across two columns instead. */}
        <div
          className={`grid grid-cols-1 gap-6 ${hasLeftColumn ? 'lg:grid-cols-3' : 'md:grid-cols-2'}`}
          data-testid={hasLeftColumn ? 'profile-grid-three' : 'profile-grid-two'}
        >
          {/* Left Column */}
          {hasLeftColumn && (
            <div className="space-y-6 lg:col-span-2">
              {/* Training & Certifications — hidden when the viewer has no
                target-scoped access; an empty card would wrongly imply the
                member has no training. */}
              {trainingEnabled && canViewTargetTraining && (
                <TrainingSection
                  userId={userId ?? ''}
                  trainings={trainings}
                  trainingsLoading={trainingsLoading}
                  complianceSummary={complianceSummary}
                  tz={tz}
                />
              )}

              {/* Admin Hours Summary */}
              {adminHoursSummary && adminHoursSummary.totalEntries > 0 && (
                <AdminHoursSection adminHoursSummary={adminHoursSummary} adminHoursCompliance={adminHoursCompliance} />
              )}
              {adminHoursLoading && (
                <div className="card p-6">
                  <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Administrative Hours</h2>
                  <div className="text-theme-text-muted py-4 text-center">Loading admin hours...</div>
                </div>
              )}

              {/* ID cards (NFC). Officers only — a member cannot register,
                relabel or revoke a card, not even their own, and the panel
                hides itself when the organization has cards turned off. */}
              {showIdCards && userId && (
                <MemberIdCardsPanel
                  userId={userId}
                  memberName={user ? `${user.first_name} ${user.last_name}`.trim() : undefined}
                />
              )}

              {/* Assigned Inventory - the member's own kit, or a quartermaster's
                view of it. Hidden from everyone else rather than rendered
                empty, which would read as "nothing issued". */}
              {inventoryModuleEnabled && canViewTargetInventory && (
                <div className="card p-6">
                  <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Assigned Inventory</h2>
                  {inventoryLoading ? (
                    <div className="text-theme-text-muted py-4 text-center">Loading inventory...</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="divide-theme-surface-border min-w-full divide-y">
                        <thead>
                          <tr>
                            <th
                              scope="col"
                              className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                            >
                              Item
                            </th>
                            <th
                              scope="col"
                              className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                            >
                              Item #
                            </th>
                            <th
                              scope="col"
                              className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                            >
                              Category
                            </th>
                            <th
                              scope="col"
                              className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                            >
                              Condition
                            </th>
                            <th
                              scope="col"
                              className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                            >
                              Assigned
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-theme-surface-border divide-y">
                          {inventoryItems.map((item) => (
                            <tr key={item.id} className="hover:bg-theme-surface-hover">
                              <td className="text-theme-text-primary px-4 py-3 text-sm font-medium">{item.name}</td>
                              <td className="text-theme-text-secondary px-4 py-3 text-sm">{item.item_number}</td>
                              <td className="text-theme-text-secondary px-4 py-3 text-sm">{item.category}</td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                                    item.condition === 'Excellent'
                                      ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                                      : item.condition === 'Good'
                                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400'
                                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400'
                                  }`}
                                >
                                  {item.condition}
                                </span>
                              </td>
                              <td className="text-theme-text-secondary px-4 py-3 text-sm">
                                {formatDate(item.assigned_date, tz)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Right Column - Contact & Additional Info. Without a left column
              these cards are the page, so they flow into the two-column grid
              rather than stacking in one narrow strip. */}
          <div className={hasLeftColumn ? 'space-y-6' : 'contents'}>
            {/* Contact Information */}
            <ContactInfoSection
              user={user}
              canEdit={canEdit}
              isEditing={isEditing}
              saving={saving}
              error={error}
              editForm={editForm}
              onEditClick={handleEditClick}
              onCancelEdit={handleCancelEdit}
              onSaveContact={handleSaveContact}
              onFormChange={handleFormChange}
              onNotificationToggle={handleNotificationToggle}
              smsConsentGranted={smsConsentGranted}
              visibilityMode={visibilityMode}
              visibility={visibility}
              visibilityReady={visibilityMode !== 'toggle' || privacy.ready}
              visibilityLoadError={visibilityMode === 'toggle' && privacy.loadError}
              visibilitySaving={privacy.savingField}
              visibilitySaveState={privacy.saveState}
              orgVisibility={orgContactVisibility}
              onVisibilityChange={(field, next) => void privacy.setField(field, next)}
              onVisibilityRetry={privacy.reload}
            />

            {/* Address & Personal Email */}
            {showAddressCard && (
              <div className="card p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-theme-text-primary text-lg font-semibold">Address</h2>
                  {canEdit && !editingAddress && (
                    <button
                      onClick={handleEditAddress}
                      className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {!editingAddress ? (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-theme-text-muted text-xs font-medium uppercase">Mailing Address</p>
                        {user.address_street || user.address_city ? (
                          <p className="text-theme-text-primary mt-1 text-sm">
                            {user.address_street && (
                              <>
                                {user.address_street}
                                <br />
                              </>
                            )}
                            {user.address_city}
                            {user.address_state ? `, ${user.address_state}` : ''} {user.address_zip}
                            {user.address_country && user.address_country !== 'USA' && (
                              <>
                                <br />
                                {user.address_country}
                              </>
                            )}
                          </p>
                        ) : (
                          <p className="text-theme-text-muted mt-1 text-sm">No address on file.</p>
                        )}
                      </div>
                      {visibilityMode !== 'none' && visibility && (
                        <VisibilityControl
                          field="address"
                          label="Mailing address"
                          visible={visibility.address}
                          mode={visibilityMode}
                          disabled={
                            visibilityMode === 'toggle' && (!privacy.ready || privacy.savingField === 'address')
                          }
                          onChange={(next) => void privacy.setField('address', next)}
                        />
                      )}
                    </div>
                    {isSelf && (
                      <p className="text-theme-text-muted text-xs">
                        Leadership can always see your address.{' '}
                        <Link
                          to="/account?tab=privacy"
                          className="font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          Manage what other members see
                        </Link>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">
                        Personal Email
                      </label>
                      <input
                        type="email"
                        value={addressForm.personal_email}
                        onChange={(e) =>
                          setAddressForm((p) => ({
                            ...p,
                            personal_email: e.target.value,
                          }))
                        }
                        className="form-input px-3 text-sm"
                        placeholder="Home email for post-separation contact"
                      />
                    </div>
                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Street</label>
                      <input
                        type="text"
                        value={addressForm.address_street}
                        onChange={(e) =>
                          setAddressForm((p) => ({
                            ...p,
                            address_street: e.target.value,
                          }))
                        }
                        className="form-input px-3 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">City</label>
                        <input
                          type="text"
                          value={addressForm.address_city}
                          onChange={(e) =>
                            setAddressForm((p) => ({
                              ...p,
                              address_city: e.target.value,
                            }))
                          }
                          className="form-input px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">State</label>
                        <input
                          type="text"
                          value={addressForm.address_state}
                          onChange={(e) =>
                            setAddressForm((p) => ({
                              ...p,
                              address_state: e.target.value,
                            }))
                          }
                          className="form-input px-3 text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">ZIP</label>
                        <input
                          type="text"
                          value={addressForm.address_zip}
                          onChange={(e) =>
                            setAddressForm((p) => ({
                              ...p,
                              address_zip: e.target.value,
                            }))
                          }
                          className="form-input px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">
                          Country
                        </label>
                        <input
                          type="text"
                          value={addressForm.address_country}
                          onChange={(e) =>
                            setAddressForm((p) => ({
                              ...p,
                              address_country: e.target.value,
                            }))
                          }
                          className="form-input px-3 text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => {
                          void handleSaveAddress();
                        }}
                        disabled={savingAddress}
                        className="btn-info flex-1 rounded-md text-sm font-medium"
                      >
                        {savingAddress ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingAddress(false)}
                        disabled={savingAddress}
                        className="btn-secondary text-theme-text-secondary flex-1 text-sm font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Emergency Contacts — leadership and the member only */}
            {canViewRestrictedPii && (
              <EmergencyContactsSection
                user={user}
                canEdit={canEdit}
                editingContacts={editingContacts}
                savingContacts={savingContacts}
                error={error}
                contactsForm={contactsForm}
                onEditEmergencyContacts={handleEditEmergencyContacts}
                onSaveEmergencyContacts={handleSaveEmergencyContacts}
                onCancelEditContacts={() => setEditingContacts(false)}
                onAddContact={handleAddContact}
                onRemoveContact={handleRemoveContact}
                onContactChange={handleContactChange}
              />
            )}

            {/* Membership — how the department describes a member: rank and
                type, where they ride, and since when. The account lifecycle
                status (active / leave / retired / dropped) is a different
                axis, managed by leadership, and stays with them. */}
            <div className="card p-6">
              <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Membership</h2>
              <div className="space-y-3">
                {rankLabel && (
                  <div>
                    <p className="text-theme-text-muted text-xs font-medium uppercase">Rank</p>
                    <p className="text-theme-text-primary mt-1 text-sm">{rankLabel}</p>
                  </div>
                )}
                {memberTypeLabel && (
                  <div>
                    <p className="text-theme-text-muted text-xs font-medium uppercase">Member type</p>
                    <p className="text-theme-text-primary mt-1 text-sm">{memberTypeLabel}</p>
                  </div>
                )}
                {user.station && (
                  <div>
                    <p className="text-theme-text-muted text-xs font-medium uppercase">Station</p>
                    <p className="text-theme-text-primary mt-1 text-sm">{user.station}</p>
                  </div>
                )}
                {user.platoon && (
                  <div>
                    <p className="text-theme-text-muted text-xs font-medium uppercase">Platoon</p>
                    <p className="text-theme-text-primary mt-1 text-sm">{user.platoon}</p>
                  </div>
                )}
                {user.hire_date && (
                  <div>
                    <p className="text-theme-text-muted text-xs font-medium uppercase">Member since</p>
                    <p className="text-theme-text-primary mt-1 text-sm">{formatDate(user.hire_date, tz)}</p>
                  </div>
                )}
                {!rankLabel && !memberTypeLabel && !user.station && !user.platoon && !user.hire_date && (
                  <p className="text-theme-text-muted text-sm">No membership details on file.</p>
                )}
                {canManageMembers && (
                  <div className="border-theme-surface-border border-t pt-3">
                    <p className="text-theme-text-muted text-xs font-medium uppercase">Status</p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-theme-text-primary text-sm capitalize">{user.status.replace(/_/g, ' ')}</p>
                      <button
                        type="button"
                        onClick={handleOpenStatusModal}
                        className="text-theme-text-muted transition hover:text-blue-500"
                        title="Change status"
                        aria-label="Change status"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {user.status === UserStatus.ACTIVE && (
                      <p className="text-theme-text-muted mt-1 text-xs">
                        Shown to you because you manage members. Other members do not see an active status.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats — only when the viewer can see at least one of the
                numbers; an empty card reads as "nothing to report". */}
            {hasQuickStats && (
              <div className="card p-6">
                <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Quick Stats</h2>
                <div className="space-y-3">
                  {trainingEnabled && canViewTargetTraining && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-theme-text-secondary text-sm">Active Training</span>
                        <span className="text-theme-text-primary text-sm font-semibold">
                          {trainings.filter((t) => t.status === 'completed' && !isExpired(t)).length}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-theme-text-secondary text-sm">Expiring Soon</span>
                        <span className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">
                          {trainings.filter((t) => isExpiringSoon(t)).length}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-theme-text-secondary text-sm">Total Hours</span>
                        <span className="text-theme-text-primary text-sm font-semibold">
                          {formatHours(sumHoursToQuarter(trainings.map((t) => t.hours_completed)))} hrs
                        </span>
                      </div>
                    </>
                  )}
                  {inventoryModuleEnabled && canViewTargetInventory && (
                    <div className="flex items-center justify-between">
                      <span className="text-theme-text-secondary text-sm">Assigned Equipment</span>
                      <span className="text-theme-text-primary text-sm font-semibold">{inventoryItems.length}</span>
                    </div>
                  )}
                  {adminHoursSummary && adminHoursSummary.totalEntries > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-theme-text-secondary text-sm">Admin Hours</span>
                      <span className="text-theme-text-primary text-sm font-semibold">
                        {formatHours(adminHoursSummary.totalHours)} hrs
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Active Leaves of Absence */}
            {activeLeaves.length > 0 && (
              <div className="card p-6">
                <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Leave of Absence</h2>
                <div className="space-y-3">
                  {activeLeaves.map((leave) => (
                    <div key={leave.id} className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-medium text-yellow-700 capitalize dark:text-yellow-400">
                          {(leave.leave_type ?? '').replace(/_/g, ' ')}
                        </span>
                        <span className="text-theme-text-muted text-xs">Active</span>
                      </div>
                      <p className="text-theme-text-secondary text-xs">
                        {/* Calendar dates, not instants — run through a
                            timezone these render a day early. */}
                        {formatCalendarDate(leave.start_date, {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}{' '}
                        &ndash;{' '}
                        {leave.end_date
                          ? formatCalendarDate(leave.end_date, {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                            })
                          : 'Permanent'}
                      </p>
                      {leave.reason && <p className="text-theme-text-muted mt-1 text-xs">{leave.reason}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status Change Modal */}
        {statusModalOpen && (
          <div className="modal-overlay z-50 flex items-center justify-center">
            <div className="bg-theme-surface modal-panel-scroll mx-4 w-full max-w-md rounded-lg p-6 shadow-xl">
              <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Change Member Status</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">New Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="form-input px-3 text-sm focus:ring-blue-500"
                  >
                    {Object.values(UserStatus).map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Reason (optional)</label>
                  <textarea
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    rows={3}
                    placeholder="Reason for the status change..."
                    className="form-input px-3 text-sm focus:ring-blue-500"
                  />
                </div>
                {(newStatus === UserStatus.DROPPED_VOLUNTARY || newStatus === UserStatus.DROPPED_INVOLUNTARY) && (
                  <p className="rounded-md border border-yellow-500/20 bg-yellow-500/10 p-2 text-xs text-yellow-600 dark:text-yellow-400">
                    Dropping a member will generate a property return report and may send an email notification.
                  </p>
                )}
                {error && <p className="text-sm text-red-500">{error}</p>}
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleStatusChange()}
                  disabled={statusChanging || newStatus === user?.status}
                  className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {statusChanging ? 'Saving...' : 'Update Status'}
                </button>
                <button
                  type="button"
                  onClick={() => setStatusModalOpen(false)}
                  disabled={statusChanging}
                  className="btn-secondary text-theme-text-secondary flex-1 text-sm font-medium transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemberProfilePage;
