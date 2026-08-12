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
import { formatCalendarDate, formatDate } from '../utils/dateFormatting';
import type { UserWithRoles } from '../types/role';
import type { ContactInfoUpdate, NotificationPreferences, EmergencyContact, UserProfileUpdate } from '../types/user';
import type { TrainingRecord, ComplianceSummary } from '../types/training';
import { AVAILABLE_MODULES } from '../types/modules';
import { MAX_AVATAR_SIZE } from '../constants/config';
import { UserStatus } from '../constants/enums';
import TrainingSection from '../components/member-profile/TrainingSection';
import AdminHoursSection from '../components/member-profile/AdminHoursSection';
import ContactInfoSection from '../components/member-profile/ContactInfoSection';
import EmergencyContactsSection from '../components/member-profile/EmergencyContactsSection';

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
  const [editForm, setEditForm] = useState<ContactInfoUpdate>({
    email: '',
    phone: '',
    mobile: '',
    notification_preferences: {
      email: true,
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

  const fetchModuleStatus = React.useCallback(
    async (uid: string) => {
      try {
        const response = await organizationService.getEnabledModules();
        const inventoryEnabled = (response?.enabled_modules ?? []).includes('inventory');
        setInventoryModuleEnabled(inventoryEnabled);

        // Fetch inventory if module is enabled
        if (inventoryEnabled) {
          void fetchInventoryItems(uid);
        }
      } catch (_err) {
        // If we can't fetch module status, default to not showing inventory
        setInventoryModuleEnabled(false);
      }
    },
    [fetchInventoryItems]
  );

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

  useEffect(() => {
    if (userId) {
      void fetchUserData(userId);
      void fetchModuleStatus(userId);
      void fetchLeaves(userId);
      void fetchAdminHours(userId);
      if (trainingEnabled) {
        void fetchTrainingRecords(userId);
        void fetchComplianceSummary(userId);
      }
    }
  }, [
    userId,
    trainingEnabled,
    fetchUserData,
    fetchModuleStatus,
    fetchLeaves,
    fetchAdminHours,
    fetchTrainingRecords,
    fetchComplianceSummary,
  ]);

  const canManageMembers = checkPermission('members.manage');

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
    setEditForm({
      email: user?.email || '',
      phone: user?.phone || '',
      mobile: user?.mobile || '',
      notification_preferences: user?.notification_preferences || {
        email: true,
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
        email: true,
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
  const canEdit = currentUser?.id === userId || isAdmin;
  // Emergency contacts are leadership-only server-side (members.manage or the
  // member themselves). Mirror that gate here so everyone else sees no section
  // at all — a rendered-but-empty section reads as "none on file", which is a
  // different and wrong statement about the member.
  const canViewRestrictedPii = canEdit;

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

          <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
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
                      className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white transition-opacity hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100"
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
                  <p className="text-theme-text-muted mt-1">@{user.username}</p>
                  {user.membership_number && (
                    <p className="text-theme-text-secondary mt-1 text-sm">#{user.membership_number}</p>
                  )}
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
                    {user.status}
                    <Pencil className="h-3 w-3" />
                  </button>
                ) : (
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${
                      user.status === UserStatus.ACTIVE
                        ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                        : 'bg-theme-surface-secondary text-theme-text-secondary'
                    }`}
                  >
                    {user.status}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left Column */}
          <div className="space-y-6 lg:col-span-2">
            {/* Training & Certifications */}
            {trainingEnabled && (
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
              <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
                <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Administrative Hours</h2>
                <div className="text-theme-text-muted py-4 text-center">Loading admin hours...</div>
              </div>
            )}

            {/* Assigned Inventory - Only shown if inventory module is enabled */}
            {inventoryModuleEnabled && (
              <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
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

          {/* Right Column - Contact & Additional Info */}
          <div className="space-y-6">
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
            />

            {/* Address & Personal Email */}
            <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
              <div className="mb-4 flex items-center justify-between">
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
                  {user.personal_email && (
                    <div>
                      <p className="text-theme-text-muted text-xs font-medium uppercase">Personal Email</p>
                      <p className="text-theme-text-primary mt-1 text-sm">{user.personal_email}</p>
                    </div>
                  )}
                  {user.address_street || user.address_city ? (
                    <div>
                      <p className="text-theme-text-muted text-xs font-medium uppercase">Mailing Address</p>
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
                    </div>
                  ) : (
                    <p className="text-theme-text-muted text-sm">No address on file.</p>
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
                      className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
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
                      className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
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
                        className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
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
                        className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
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
                        className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Country</label>
                      <input
                        type="text"
                        value={addressForm.address_country}
                        onChange={(e) =>
                          setAddressForm((p) => ({
                            ...p,
                            address_country: e.target.value,
                          }))
                        }
                        className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
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
                      className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex-1 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

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

            {/* Employment Info */}
            <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
              <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Employment</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-theme-text-muted text-xs font-medium uppercase">Status</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-theme-text-primary text-sm capitalize">{user.status.replace(/_/g, ' ')}</p>
                    {canManageMembers && (
                      <button
                        type="button"
                        onClick={handleOpenStatusModal}
                        className="text-theme-text-muted transition hover:text-blue-500"
                        title="Change status"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {user.hire_date && (
                  <div>
                    <p className="text-theme-text-muted text-xs font-medium uppercase">Hire Date</p>
                    <p className="text-theme-text-primary mt-1 text-sm">{formatDate(user.hire_date, tz)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
              <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Quick Stats</h2>
              <div className="space-y-3">
                {trainingEnabled && (
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
                        {trainings.reduce((sum, t) => sum + (t.hours_completed || 0), 0)} hrs
                      </span>
                    </div>
                  </>
                )}
                {inventoryModuleEnabled && (
                  <div className="flex items-center justify-between">
                    <span className="text-theme-text-secondary text-sm">Assigned Equipment</span>
                    <span className="text-theme-text-primary text-sm font-semibold">{inventoryItems.length}</span>
                  </div>
                )}
                {adminHoursSummary && adminHoursSummary.totalEntries > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-theme-text-secondary text-sm">Admin Hours</span>
                    <span className="text-theme-text-primary text-sm font-semibold">
                      {adminHoursSummary.totalHours.toFixed(1)} hrs
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Active Leaves of Absence */}
            {activeLeaves.length > 0 && (
              <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-theme-surface mx-4 w-full max-w-md rounded-lg p-6 shadow-xl">
              <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Change Member Status</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">New Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="border-theme-surface-border bg-theme-surface text-theme-text-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
                    className="border-theme-surface-border bg-theme-surface text-theme-text-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
                  className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex-1 rounded-md border px-4 py-2 text-sm font-medium transition disabled:opacity-50"
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
