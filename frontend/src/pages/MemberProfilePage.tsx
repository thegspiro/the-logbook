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
import { useParams, useNavigate, Link } from 'react-router-dom';
import { userService, organizationService, trainingService, inventoryService, memberStatusService } from '../services/api';
import type { LeaveOfAbsenceResponse } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import type { UserWithRoles } from '../types/role';
import type { ContactInfoUpdate, NotificationPreferences, EmergencyContact, UserProfileUpdate } from '../types/user';
import type { TrainingRecord } from '../types/training';
import { AVAILABLE_MODULES } from '../types/modules';

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
      sms: false,
      push: false,
      email_notifications: true,
      event_reminders: true,
      training_reminders: true,
      announcement_notifications: true,
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
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [activeLeaves, setActiveLeaves] = useState<LeaveOfAbsenceResponse[]>([]);

  // Module enablement checks
  const trainingEnabled = isModuleEnabled('training');

  useEffect(() => {
    if (userId) {
      fetchUserData();
      fetchModuleStatus();
      fetchLeaves();
      if (trainingEnabled) {
        fetchTrainingRecords();
      }
    }
  }, [userId, trainingEnabled]);

  const fetchModuleStatus = async () => {
    try {
      const response = await organizationService.getEnabledModules();
      const inventoryEnabled = (response?.enabled_modules ?? []).includes('inventory');
      setInventoryModuleEnabled(inventoryEnabled);

      // Fetch inventory if module is enabled
      if (inventoryEnabled && userId) {
        fetchInventoryItems();
      }
    } catch (_err) {
      // If we can't fetch module status, default to not showing inventory
      setInventoryModuleEnabled(false);
    }
  };

  const fetchUserData = async () => {
    try {
      setLoading(true);
      setError(null);
      const userData = await userService.getUserWithRoles(userId!);
      setUser(userData);
    } catch (_err) {
      setError('Unable to load member information. The member may not exist or you may not have access.');
    } finally {
      setLoading(false);
    }
  };

  const fetchTrainingRecords = async () => {
    try {
      setTrainingsLoading(true);
      const records = await trainingService.getRecords({ user_id: userId! });
      setTrainings(records);
    } catch (_err) {
      // Don't set error - show empty state
    } finally {
      setTrainingsLoading(false);
    }
  };

  const fetchInventoryItems = async () => {
    try {
      setInventoryLoading(true);
      const response = await inventoryService.getUserInventory(userId!);
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
  };

  const fetchLeaves = async () => {
    try {
      const data = await memberStatusService.getMemberLeaves(userId!);
      setActiveLeaves(data);
    } catch {
      // Don't set error - show empty state
    }
  };

  const getTrainingStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400';
      case 'scheduled':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400';
      case 'cancelled':
        return 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400';
    }
  };

  /** Check if a training record's certification is expiring within 90 days. */
  const isExpiringSoon = (record: TrainingRecord): boolean => {
    if (!record.expiration_date) return false;
    const expDate = new Date(record.expiration_date);
    const now = new Date();
    const daysUntilExpiry = (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry > 0 && daysUntilExpiry <= 90;
  };

  const isExpired = (record: TrainingRecord): boolean => {
    if (!record.expiration_date) return false;
    return new Date(record.expiration_date) < new Date();
  };

  const handleEditClick = () => {
    setEditForm({
      email: user?.email || '',
      phone: user?.phone || '',
      mobile: user?.mobile || '',
      notification_preferences: user?.notification_preferences || {
        email: true,
        sms: false,
        push: false,
        email_notifications: true,
        event_reminders: true,
        training_reminders: true,
        announcement_notifications: true,
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
    setEditForm((prev) => ({
      ...prev,
      notification_preferences: {
        ...prev.notification_preferences!,
        [type]: !prev.notification_preferences![type],
      },
    }));
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
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB.');
      return;
    }

    try {
      setUploadingPhoto(true);
      setError(null);
      const result = await userService.uploadPhoto(userId, file);
      setUser((prev) => prev ? { ...prev, photo_url: result.photo_url } : prev);
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
      setUser((prev) => prev ? { ...prev, photo_url: undefined } : prev);
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
    setContactsForm(user?.emergency_contacts?.length
      ? user.emergency_contacts.map((ec) => ({ ...ec }))
      : [{ name: '', relationship: '', phone: '', email: '', is_primary: true }]
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
    setContactsForm((prev) => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
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
      const updated = await userService.updateUserProfile(userId, { emergency_contacts: contactsForm });
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

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="text-theme-text-muted">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-sm text-red-400">{error || 'Member not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-sm text-red-400">Member not found</p>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-theme-text-muted hover:text-theme-text-secondary mb-4 flex items-center gap-1"
        >
          &larr; Back
        </button>

        <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              {/* Profile Photo with Upload */}
              <div className="relative group">
                {user.photo_url ? (
                  <img
                    src={user.photo_url}
                    alt={user.full_name || user.username}
                    className="h-20 w-20 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-indigo-100 flex items-center justify-center">
                    <span className="text-2xl font-bold text-indigo-600">
                      {(user.first_name?.[0] || user.username?.[0] || '?').toUpperCase()}
                    </span>
                  </div>
                )}
                {canEdit && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handlePhotoUpload}
                    />
                    {uploadingPhoto ? (
                      <span className="text-white text-xs">Uploading...</span>
                    ) : (
                      <button
                        onClick={handlePhotoClick}
                        className="text-white text-xs font-medium"
                        aria-label="Upload photo"
                      >
                        {user.photo_url ? 'Change' : 'Upload'}
                      </button>
                    )}
                  </div>
                )}
                {canEdit && user.photo_url && (
                  <button
                    onClick={handlePhotoRemove}
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    aria-label="Remove photo"
                    title="Remove photo"
                  >
                    &times;
                  </button>
                )}
              </div>
              <div>
                <h1 className="text-3xl font-bold text-theme-text-primary">
                  {user.full_name || user.username}
                </h1>
                <p className="text-theme-text-muted mt-1">@{user.username}</p>
                {user.membership_number && (
                  <p className="text-sm text-theme-text-secondary mt-1">#{user.membership_number}</p>
                )}
                <div className="flex gap-2 mt-2">
                  {(user.roles || []).map((role) => (
                    <span
                      key={role.id}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        role.is_system ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'
                      }`}
                    >
                      {role.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <span
              className={`px-3 py-1 text-sm font-semibold rounded-full ${
                user.status === 'active'
                  ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'
              }`}
            >
              {user.status}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Training & Certifications */}
          {trainingEnabled && (
            <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-theme-text-primary">
                  Training & Certifications
                </h2>
                <Link
                  to={`/members/${userId}/training`}
                  className="text-sm text-blue-400 hover:text-blue-300 font-medium"
                >
                  View Full History
                </Link>
              </div>
              {trainingsLoading ? (
                <div className="flex items-center justify-center h-24">
                  <div className="text-sm text-theme-text-muted">Loading training records...</div>
                </div>
              ) : trainings.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-theme-text-muted">No training records found.</p>
                  <p className="text-xs text-theme-text-muted mt-1">Training records will appear here as they are completed.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Show only the 5 most recent/important records */}
                  {trainings.slice(0, 5).map((training) => (
                    <div
                      key={training.id}
                      className="border border-theme-surface-border rounded-lg p-4 hover:border-theme-surface-border transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-medium text-theme-text-primary">{training.course_name}</h3>
                          {training.certification_number && (
                            <p className="text-sm text-theme-text-secondary mt-1">
                              Cert #: {training.certification_number}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-4 mt-2 text-sm text-theme-text-secondary">
                            {training.completion_date && (
                              <span>Completed: {formatDate(training.completion_date, tz)}</span>
                            )}
                            {training.expiration_date && (
                              <span className={isExpired(training) ? 'text-red-400' : isExpiringSoon(training) ? 'text-yellow-400' : ''}>
                                Expires: {formatDate(training.expiration_date, tz)}
                              </span>
                            )}
                            {training.hours_completed > 0 && (
                              <span>{training.hours_completed} hrs</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium ${getTrainingStatusColor(
                              training.status
                            )}`}
                          >
                            {training.status.replace('_', ' ')}
                          </span>
                          {isExpired(training) && (
                            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400">
                              expired
                            </span>
                          )}
                          {!isExpired(training) && isExpiringSoon(training) && (
                            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">
                              expiring soon
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {trainings.length > 5 && (
                    <Link
                      to={`/members/${userId}/training`}
                      className="block text-center py-3 text-sm text-blue-400 hover:text-blue-300 border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                    >
                      View all {trainings.length} training records →
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Assigned Inventory - Only shown if inventory module is enabled */}
          {inventoryModuleEnabled && (
            <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Assigned Inventory</h2>
              {inventoryLoading ? (
                <div className="text-center py-4 text-theme-text-muted">Loading inventory...</div>
              ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-theme-surface-border">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">
                        Item
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">
                        Item #
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">
                        Category
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">
                        Condition
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase">
                        Assigned
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-surface-border">
                    {inventoryItems.map((item) => (
                      <tr key={item.id} className="hover:bg-theme-surface-hover">
                        <td className="px-4 py-3 text-sm font-medium text-theme-text-primary">
                          {item.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">{item.item_number}</td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">{item.category}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
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
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">
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
          <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-theme-text-primary">Contact Information</h2>
              {canEdit && !isEditing && (
                <button
                  onClick={handleEditClick}
                  className="text-sm text-blue-400 hover:text-blue-300 font-medium"
                >
                  Edit
                </button>
              )}
            </div>

            {!isEditing ? (
              <div className="space-y-3">
                {user.email && (
                  <div>
                    <p className="text-xs text-theme-text-muted uppercase font-medium">Email</p>
                    <p className="text-sm text-theme-text-primary mt-1">{user.email}</p>
                  </div>
                )}
                {user.phone && (
                  <div>
                    <p className="text-xs text-theme-text-muted uppercase font-medium">Phone</p>
                    <p className="text-sm text-theme-text-primary mt-1">{user.phone}</p>
                  </div>
                )}
                {user.mobile && (
                  <div>
                    <p className="text-xs text-theme-text-muted uppercase font-medium">Mobile</p>
                    <p className="text-sm text-theme-text-primary mt-1">{user.mobile}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => handleFormChange('email', e.target.value)}
                    className="form-input w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) => handleFormChange('phone', e.target.value)}
                    className="form-input w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">
                    Mobile
                  </label>
                  <input
                    type="tel"
                    value={editForm.mobile}
                    onChange={(e) => handleFormChange('mobile', e.target.value)}
                    className="form-input w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="pt-4 border-t border-theme-surface-border">
                  <label className="block text-xs text-theme-text-muted uppercase font-medium mb-3">
                    Notification Preferences
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.notification_preferences?.email}
                        onChange={() => handleNotificationToggle('email')}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
                      />
                      <span className="ml-2 text-sm text-theme-text-secondary">Email notifications</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.notification_preferences?.sms}
                        onChange={() => handleNotificationToggle('sms')}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
                      />
                      <span className="ml-2 text-sm text-theme-text-secondary">SMS notifications</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.notification_preferences?.push}
                        onChange={() => handleNotificationToggle('push')}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
                      />
                      <span className="ml-2 text-sm text-theme-text-secondary">Push notifications</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    onClick={handleSaveContact}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-theme-surface text-theme-text-secondary text-sm font-medium border border-theme-surface-border rounded-md hover:bg-theme-surface-hover disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>

                {error && (
                  <div className="mt-2 text-sm text-red-400">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Address & Personal Email */}
          <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-theme-text-primary">Address</h2>
              {canEdit && !editingAddress && (
                <button onClick={handleEditAddress} className="text-sm text-blue-400 hover:text-blue-300 font-medium">
                  Edit
                </button>
              )}
            </div>
            {!editingAddress ? (
              <div className="space-y-3">
                {user.personal_email && (
                  <div>
                    <p className="text-xs text-theme-text-muted uppercase font-medium">Personal Email</p>
                    <p className="text-sm text-theme-text-primary mt-1">{user.personal_email}</p>
                  </div>
                )}
                {(user.address_street || user.address_city) ? (
                  <div>
                    <p className="text-xs text-theme-text-muted uppercase font-medium">Mailing Address</p>
                    <p className="text-sm text-theme-text-primary mt-1">
                      {user.address_street && <>{user.address_street}<br /></>}
                      {user.address_city}{user.address_state ? `, ${user.address_state}` : ''} {user.address_zip}
                      {user.address_country && user.address_country !== 'USA' && <><br />{user.address_country}</>}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-theme-text-muted">No address on file.</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Personal Email</label>
                  <input
                    type="email"
                    value={addressForm.personal_email}
                    onChange={(e) => setAddressForm((p) => ({ ...p, personal_email: e.target.value }))}
                    className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Home email for post-separation contact"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Street</label>
                  <input
                    type="text"
                    value={addressForm.address_street}
                    onChange={(e) => setAddressForm((p) => ({ ...p, address_street: e.target.value }))}
                    className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">City</label>
                    <input
                      type="text"
                      value={addressForm.address_city}
                      onChange={(e) => setAddressForm((p) => ({ ...p, address_city: e.target.value }))}
                      className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">State</label>
                    <input
                      type="text"
                      value={addressForm.address_state}
                      onChange={(e) => setAddressForm((p) => ({ ...p, address_state: e.target.value }))}
                      className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">ZIP</label>
                    <input
                      type="text"
                      value={addressForm.address_zip}
                      onChange={(e) => setAddressForm((p) => ({ ...p, address_zip: e.target.value }))}
                      className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-theme-text-muted uppercase font-medium mb-1">Country</label>
                    <input
                      type="text"
                      value={addressForm.address_country}
                      onChange={(e) => setAddressForm((p) => ({ ...p, address_country: e.target.value }))}
                      className="w-full px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={handleSaveAddress} disabled={savingAddress} className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50">
                    {savingAddress ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setEditingAddress(false)} disabled={savingAddress} className="flex-1 px-4 py-2 bg-theme-surface text-theme-text-secondary text-sm font-medium border border-theme-surface-border rounded-md hover:bg-theme-surface-hover disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Emergency Contacts */}
          <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-theme-text-primary">Emergency Contacts</h2>
              {canEdit && !editingContacts && (
                <button onClick={handleEditEmergencyContacts} className="text-sm text-blue-400 hover:text-blue-300 font-medium">
                  Edit
                </button>
              )}
            </div>
            {!editingContacts ? (
              <div className="space-y-3">
                {(user.emergency_contacts && user.emergency_contacts.length > 0) ? (
                  user.emergency_contacts.map((ec, i) => (
                    <div key={i} className="border border-theme-surface-border rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-theme-text-primary">{ec.name}</p>
                        {ec.is_primary && (
                          <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400 rounded">Primary</span>
                        )}
                      </div>
                      <p className="text-xs text-theme-text-secondary mt-1">{ec.relationship}</p>
                      <p className="text-xs text-theme-text-secondary">{ec.phone}</p>
                      {ec.email && <p className="text-xs text-theme-text-secondary">{ec.email}</p>}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-theme-text-muted">No emergency contacts on file.</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {contactsForm.map((ec, i) => (
                  <div key={i} className="border border-theme-surface-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-theme-text-muted">Contact {i + 1}</span>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-theme-text-secondary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ec.is_primary}
                            onChange={(e) => handleContactChange(i, 'is_primary', e.target.checked)}
                            className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-theme-surface-border rounded"
                          />
                          Primary
                        </label>
                        {contactsForm.length > 1 && (
                          <button onClick={() => handleRemoveContact(i)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Name *"
                        value={ec.name}
                        onChange={(e) => handleContactChange(i, 'name', e.target.value)}
                        className="px-2 py-1.5 border border-theme-surface-border rounded text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        placeholder="Relationship"
                        value={ec.relationship}
                        onChange={(e) => handleContactChange(i, 'relationship', e.target.value)}
                        className="px-2 py-1.5 border border-theme-surface-border rounded text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="tel"
                        placeholder="Phone *"
                        value={ec.phone}
                        onChange={(e) => handleContactChange(i, 'phone', e.target.value)}
                        className="px-2 py-1.5 border border-theme-surface-border rounded text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={ec.email || ''}
                        onChange={(e) => handleContactChange(i, 'email', e.target.value)}
                        className="px-2 py-1.5 border border-theme-surface-border rounded text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                ))}
                <button onClick={handleAddContact} className="w-full px-3 py-2 text-sm text-blue-400 border border-dashed border-theme-surface-border rounded-md hover:bg-theme-surface-hover">
                  + Add Contact
                </button>
                <div className="flex gap-2">
                  <button onClick={handleSaveEmergencyContacts} disabled={savingContacts} className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50">
                    {savingContacts ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setEditingContacts(false)} disabled={savingContacts} className="flex-1 px-4 py-2 bg-theme-surface text-theme-text-secondary text-sm font-medium border border-theme-surface-border rounded-md hover:bg-theme-surface-hover disabled:opacity-50">
                    Cancel
                  </button>
                </div>
                {error && <div className="text-sm text-red-400">{error}</div>}
              </div>
            )}
          </div>

          {/* Employment Info */}
          <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Employment</h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-theme-text-muted uppercase font-medium">Status</p>
                <p className="text-sm text-theme-text-primary mt-1 capitalize">{user.status}</p>
              </div>
              {user.hire_date && (
                <div>
                  <p className="text-xs text-theme-text-muted uppercase font-medium">Hire Date</p>
                  <p className="text-sm text-theme-text-primary mt-1">{formatDate(user.hire_date, tz)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Quick Stats</h2>
            <div className="space-y-3">
              {trainingEnabled && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-theme-text-secondary">Active Training</span>
                    <span className="text-sm font-semibold text-theme-text-primary">
                      {trainings.filter((t) => t.status === 'completed' && !isExpired(t)).length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-theme-text-secondary">Expiring Soon</span>
                    <span className="text-sm font-semibold text-yellow-400">
                      {trainings.filter((t) => isExpiringSoon(t)).length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-theme-text-secondary">Total Hours</span>
                    <span className="text-sm font-semibold text-theme-text-primary">
                      {trainings.reduce((sum, t) => sum + (t.hours_completed || 0), 0)} hrs
                    </span>
                  </div>
                </>
              )}
              {inventoryModuleEnabled && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-theme-text-secondary">Assigned Equipment</span>
                  <span className="text-sm font-semibold text-theme-text-primary">
                    {inventoryItems.length}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Active Leaves of Absence */}
          {activeLeaves.length > 0 && (
            <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
              <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Leave of Absence</h2>
              <div className="space-y-3">
                {activeLeaves.map((leave) => (
                  <div key={leave.id} className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400 capitalize">
                        {leave.leave_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-theme-text-muted">Active</span>
                    </div>
                    <p className="text-xs text-theme-text-secondary">
                      {new Date(leave.start_date + 'T00:00:00').toLocaleDateString()} &ndash; {new Date(leave.end_date + 'T00:00:00').toLocaleDateString()}
                    </p>
                    {leave.reason && (
                      <p className="text-xs text-theme-text-muted mt-1">{leave.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default MemberProfilePage;
