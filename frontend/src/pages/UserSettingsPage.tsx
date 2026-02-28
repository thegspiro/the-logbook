/**
 * User Settings Page
 *
 * Allows users to manage their personal account settings, password,
 * appearance, and notification preferences.
 */

import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { User, Lock, Bell, Eye, EyeOff, CheckCircle, Sun, Moon, Monitor, Palette, AlertTriangle, Heart, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { authService, userService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { validatePasswordStrength } from '../utils/passwordValidation';
import type { PasswordChangeData } from '../types/auth';
import type { UserProfileUpdate, EmergencyContact } from '../types/user';
import type { UserWithRoles } from '../types/role';
import { getErrorMessage } from '../utils/errorHandling';
import { useRanks } from '../hooks/useRanks';

type TabType = 'account' | 'password' | 'emergency' | 'appearance' | 'notifications';

export const UserSettingsPage: React.FC = () => {
  const { user, loadUser } = useAuthStore();
  const { rankOptions } = useRanks();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const forcePasswordChange = (location.state as { forcePasswordChange?: boolean } | null)?.forcePasswordChange
    || user?.must_change_password
    || user?.password_expired;
  const [activeTab, setActiveTab] = useState<TabType>(forcePasswordChange ? 'password' : 'account');

  // Profile state
  const [_profile, setProfile] = useState<UserWithRoles | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<UserProfileUpdate>({});

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Notification preferences state
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [eventReminders, setEventReminders] = useState(true);
  const [trainingReminders, setTrainingReminders] = useState(true);
  const [announcementNotifications, setAnnouncementNotifications] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [_loadingPreferences, setLoadingPreferences] = useState(false);

  // Emergency contacts state
  const [contactsForm, setContactsForm] = useState<EmergencyContact[]>([]);
  const [savingContacts, setSavingContacts] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  // Load user profile
  useEffect(() => {
    if (!user?.id) return;
    const loadProfile = async () => {
      setLoadingProfile(true);
      try {
        const data = await userService.getUserWithRoles(user.id);
        setProfile(data);
        setProfileForm({
          first_name: data.first_name || '',
          middle_name: data.middle_name || '',
          last_name: data.last_name || '',
          phone: data.phone || '',
          mobile: data.mobile || '',
          membership_number: data.membership_number || '',
          rank: data.rank || '',
          station: data.station || '',
          address_street: data.address_street || '',
          address_city: data.address_city || '',
          address_state: data.address_state || '',
          address_zip: data.address_zip || '',
          address_country: data.address_country || 'USA',
        });
        setContactsForm(
          data.emergency_contacts?.length
            ? data.emergency_contacts.map((ec: EmergencyContact) => ({ ...ec }))
            : [],
        );
      } catch {
        // Profile load failure is non-critical for other tabs
      } finally {
        setLoadingProfile(false);
      }
    };
    void loadProfile();
  }, [user?.id]);

  // Load notification preferences from backend
  useEffect(() => {
    if (!user?.id) return;
    const loadPreferences = async () => {
      setLoadingPreferences(true);
      try {
        const prefs = await userService.getNotificationPreferences(user.id);
        setEmailNotifications(prefs.email_notifications ?? true);
        setEventReminders(prefs.event_reminders ?? true);
        setTrainingReminders(prefs.training_reminders ?? true);
        setAnnouncementNotifications(prefs.announcement_notifications ?? true);
      } catch {
        // Use defaults if fetch fails
      } finally {
        setLoadingPreferences(false);
      }
    };
    void loadPreferences();
  }, [user?.id]);

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    setSavingProfile(true);
    try {
      // Strip fields that are only editable by Membership Coordinators via Members admin
      const { membership_number: _mn, rank: _r, station: _s, ...editableFields } = profileForm;
      const updated = await userService.updateUserProfile(user.id, editableFields);
      setProfile(updated);
      toast.success('Profile updated successfully!');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update profile. Please try again.'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleProfileChange = (field: keyof UserProfileUpdate, value: string) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  };

  const passwordValidation = validatePasswordStrength(newPassword);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    // Validate password strength
    if (!passwordValidation.isValid) {
      toast.error('Please ensure your password meets all the requirements');
      return;
    }

    setChangingPassword(true);

    try {
      const data: PasswordChangeData = {
        current_password: currentPassword,
        new_password: newPassword,
      };

      await authService.changePassword(data);

      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // Reload user to clear must_change_password flag
      await loadUser();

      toast.success('Password changed successfully!');
    } catch (err: unknown) {
      toast.error(
        getErrorMessage(err, 'Failed to change password. Please check your current password and try again.')
      );
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSavePreferences = async () => {
    if (!user?.id) return;
    setSavingPreferences(true);

    try {
      await userService.updateNotificationPreferences(user.id, {
        email_notifications: emailNotifications,
        event_reminders: eventReminders,
        training_reminders: trainingReminders,
        announcement_notifications: announcementNotifications,
      });

      toast.success('Preferences saved successfully!');
    } catch (err: unknown) {
      toast.error(
        getErrorMessage(err, 'Failed to save preferences. Please try again.')
      );
    } finally {
      setSavingPreferences(false);
    }
  };

  // Emergency contacts handlers
  const handleAddContact = () => {
    setContactsForm((prev) => [
      ...prev,
      { name: '', relationship: '', phone: '', email: '', is_primary: prev.length === 0 },
    ]);
  };

  const handleRemoveContact = (index: number) => {
    setContactsForm((prev) => prev.filter((_, i) => i !== index));
  };

  const handleContactChange = (
    index: number,
    field: keyof EmergencyContact,
    value: string | boolean,
  ) => {
    setContactsForm((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  };

  const handleSaveEmergencyContacts = async () => {
    if (!user?.id) return;
    // Validate at least name and phone for each contact
    const valid = contactsForm.every((c) => c.name.trim() && c.phone.trim());
    if (!valid) {
      setContactsError('Each emergency contact must have a name and phone number.');
      return;
    }
    try {
      setSavingContacts(true);
      setContactsError(null);
      const updated = await userService.updateUserProfile(user.id, {
        emergency_contacts: contactsForm,
      });
      setProfile(updated);
      setContactsForm(
        updated.emergency_contacts?.length
          ? updated.emergency_contacts.map((ec: EmergencyContact) => ({ ...ec }))
          : [],
      );
      toast.success('Emergency contacts updated successfully!');
    } catch (err: unknown) {
      setContactsError(getErrorMessage(err, 'Unable to update emergency contacts.'));
    } finally {
      setSavingContacts(false);
    }
  };

  const themeOptions = [
    {
      value: 'light' as const,
      label: 'Light',
      description: 'A clean, bright interface',
      icon: Sun,
    },
    {
      value: 'dark' as const,
      label: 'Dark',
      description: 'Easier on the eyes in low light',
      icon: Moon,
    },
    {
      value: 'system' as const,
      label: 'System',
      description: 'Follows your device settings',
      icon: Monitor,
    },
  ];

  const tabs = [
    { id: 'account' as TabType, label: 'Account', icon: User },
    { id: 'password' as TabType, label: 'Password', icon: Lock },
    { id: 'emergency' as TabType, label: 'Emergency Contacts', icon: Heart },
    { id: 'appearance' as TabType, label: 'Appearance', icon: Palette },
    { id: 'notifications' as TabType, label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-theme-text-primary mb-2">User Settings</h1>
        <p className="text-theme-text-secondary">Manage your account settings and preferences</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-theme-surface-border mb-6">
        <nav className="flex space-x-6" aria-label="Settings tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 pb-4 px-1 border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  activeTab === tab.id
                    ? 'border-red-500 text-theme-text-primary'
                    : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
                }`}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="font-medium">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-theme-surface backdrop-blur-sm border border-theme-surface-border rounded-lg p-6">
        {/* Account Tab */}
        {activeTab === 'account' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-theme-text-primary mb-4">Account Information</h2>
              <p className="text-theme-text-secondary text-sm mb-6">
                Update your personal details and contact information
              </p>
            </div>

            {loadingProfile ? (
              <div className="flex justify-center items-center h-32">
                <div className="text-theme-text-muted">Loading profile...</div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Personal Information */}
                <div>
                  <h3 className="text-sm font-medium text-theme-text-secondary mb-3 uppercase tracking-wider">Personal Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="firstName" className="block text-sm font-medium text-theme-text-secondary mb-1">First Name</label>
                      <input
                        id="firstName"
                        type="text"
                        value={profileForm.first_name || ''}
                        onChange={(e) => handleProfileChange('first_name', e.target.value)}
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div>
                      <label htmlFor="middleName" className="block text-sm font-medium text-theme-text-secondary mb-1">Middle Name</label>
                      <input
                        id="middleName"
                        type="text"
                        value={profileForm.middle_name || ''}
                        onChange={(e) => handleProfileChange('middle_name', e.target.value)}
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div>
                      <label htmlFor="lastName" className="block text-sm font-medium text-theme-text-secondary mb-1">Last Name</label>
                      <input
                        id="lastName"
                        type="text"
                        value={profileForm.last_name || ''}
                        onChange={(e) => handleProfileChange('last_name', e.target.value)}
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div>
                  <h3 className="text-sm font-medium text-theme-text-secondary mb-3 uppercase tracking-wider">Contact Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="phone" className="block text-sm font-medium text-theme-text-secondary mb-1">Phone</label>
                      <input
                        id="phone"
                        type="tel"
                        value={profileForm.phone || ''}
                        onChange={(e) => handleProfileChange('phone', e.target.value)}
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div>
                      <label htmlFor="mobile" className="block text-sm font-medium text-theme-text-secondary mb-1">Mobile</label>
                      <input
                        id="mobile"
                        type="tel"
                        value={profileForm.mobile || ''}
                        onChange={(e) => handleProfileChange('mobile', e.target.value)}
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                  </div>
                </div>

                {/* Department Information */}
                <div>
                  <h3 className="text-sm font-medium text-theme-text-secondary mb-3 uppercase tracking-wider">Department Information</h3>
                  <p className="text-xs text-theme-text-muted mb-3">
                    These fields can only be changed by a Membership Coordinator from the Members admin page.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="membershipNumber" className="block text-sm font-medium text-theme-text-secondary mb-1">Membership Number</label>
                      <input
                        id="membershipNumber"
                        type="text"
                        value={profileForm.membership_number || ''}
                        readOnly
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-surface-secondary opacity-60 cursor-not-allowed text-theme-text-primary placeholder-theme-text-muted sm:text-sm"
                        disabled
                      />
                    </div>
                    <div>
                      <label htmlFor="rank" className="block text-sm font-medium text-theme-text-secondary mb-1">Rank</label>
                      <input
                        id="rank"
                        type="text"
                        value={rankOptions.find((r) => r.value === profileForm.rank)?.label || profileForm.rank || '—'}
                        readOnly
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-surface-secondary opacity-60 cursor-not-allowed text-theme-text-primary sm:text-sm"
                        disabled
                      />
                    </div>
                    <div>
                      <label htmlFor="station" className="block text-sm font-medium text-theme-text-secondary mb-1">Station</label>
                      <input
                        id="station"
                        type="text"
                        value={profileForm.station || ''}
                        readOnly
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-surface-secondary opacity-60 cursor-not-allowed text-theme-text-primary placeholder-theme-text-muted sm:text-sm"
                        disabled
                      />
                    </div>
                  </div>
                </div>

                {/* Address */}
                <div>
                  <h3 className="text-sm font-medium text-theme-text-secondary mb-3 uppercase tracking-wider">Address</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="addressStreet" className="block text-sm font-medium text-theme-text-secondary mb-1">Street Address</label>
                      <input
                        id="addressStreet"
                        type="text"
                        value={profileForm.address_street || ''}
                        onChange={(e) => handleProfileChange('address_street', e.target.value)}
                        className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="col-span-2 sm:col-span-1">
                        <label htmlFor="addressCity" className="block text-sm font-medium text-theme-text-secondary mb-1">City</label>
                        <input
                          id="addressCity"
                          type="text"
                          value={profileForm.address_city || ''}
                          onChange={(e) => handleProfileChange('address_city', e.target.value)}
                          className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                      <div>
                        <label htmlFor="addressState" className="block text-sm font-medium text-theme-text-secondary mb-1">State</label>
                        <input
                          id="addressState"
                          type="text"
                          value={profileForm.address_state || ''}
                          onChange={(e) => handleProfileChange('address_state', e.target.value)}
                          className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                      <div>
                        <label htmlFor="addressZip" className="block text-sm font-medium text-theme-text-secondary mb-1">ZIP Code</label>
                        <input
                          id="addressZip"
                          type="text"
                          value={profileForm.address_zip || ''}
                          onChange={(e) => handleProfileChange('address_zip', e.target.value)}
                          className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <div className="pt-4 border-t border-theme-surface-border">
                  <button
                    onClick={() => { void handleSaveProfile(); }}
                    disabled={savingProfile}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {savingProfile ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Password Tab */}
        {activeTab === 'password' && (
          <div className="space-y-6">
            {forcePasswordChange && (
              <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-300 dark:border-yellow-500/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                    Password change required
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
                    Your administrator has required you to change your password before continuing. Please set a new password below.
                  </p>
                </div>
              </div>
            )}
            <div>
              <h2 className="text-xl font-semibold text-theme-text-primary mb-4">Change Password</h2>
              <p className="text-theme-text-secondary text-sm mb-6">
                Update your password to keep your account secure
              </p>
            </div>

            <form onSubmit={(e) => { void handlePasswordChange(e); }} className="space-y-4">
              {/* Current Password */}
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Current Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-theme-text-muted" aria-hidden="true" />
                  </div>
                  <input
                    id="currentPassword"
                    name="currentPassword"
                    type={showCurrentPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    className="block w-full pl-10 pr-10 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                    placeholder="Enter current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-theme-text-muted hover:text-theme-text-primary focus:outline-none"
                    aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-theme-text-muted" aria-hidden="true" />
                  </div>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    className="block w-full pl-10 pr-10 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-theme-text-muted hover:text-theme-text-primary focus:outline-none"
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                </div>

                {/* Password strength indicator */}
                {newPassword && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-theme-text-secondary font-medium">Password must contain:</p>
                    <ul className="space-y-1 text-xs">
                      {[
                        { label: 'At least 8 characters', valid: passwordValidation.checks.length },
                        { label: 'One uppercase letter', valid: passwordValidation.checks.uppercase },
                        { label: 'One lowercase letter', valid: passwordValidation.checks.lowercase },
                        { label: 'One number', valid: passwordValidation.checks.number },
                        { label: 'One special character', valid: passwordValidation.checks.special },
                      ].map((check, idx) => (
                        <li key={idx} className="flex items-center space-x-2">
                          {check.valid ? (
                            <CheckCircle className="w-4 h-4 text-green-500 dark:text-green-400 flex-shrink-0" aria-hidden="true" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-theme-surface-border flex-shrink-0" aria-hidden="true" />
                          )}
                          <span className={check.valid ? 'text-green-600 dark:text-green-300' : 'text-theme-text-muted'}>
                            {check.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-theme-text-secondary mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-theme-text-muted" aria-hidden="true" />
                  </div>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    className="block w-full pl-10 pr-10 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-theme-text-muted hover:text-theme-text-primary focus:outline-none"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="mt-2 text-sm text-red-500 dark:text-red-300">Passwords do not match</p>
                )}
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={changingPassword || !passwordValidation.isValid || newPassword !== confirmPassword}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {changingPassword ? 'Changing Password...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Emergency Contacts Tab */}
        {activeTab === 'emergency' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-theme-text-primary mb-4">Emergency Contacts</h2>
              <p className="text-theme-text-secondary text-sm mb-6">
                Add emergency contacts so your department can reach someone on your behalf if needed
              </p>
            </div>

            {loadingProfile ? (
              <div className="flex justify-center items-center h-32">
                <div className="text-theme-text-muted">Loading contacts...</div>
              </div>
            ) : (
              <div className="space-y-4">
                {contactsForm.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-theme-surface-border rounded-lg">
                    <Heart className="w-10 h-10 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
                    <p className="text-sm text-theme-text-muted mb-4">No emergency contacts on file.</p>
                    <button
                      onClick={handleAddContact}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      Add Emergency Contact
                    </button>
                  </div>
                ) : (
                  <>
                    {contactsForm.map((ec, i) => (
                      <div
                        key={i}
                        className="border border-theme-surface-border rounded-lg p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-theme-text-secondary">
                            Contact {i + 1}
                          </span>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-sm text-theme-text-secondary cursor-pointer">
                              <input
                                type="checkbox"
                                checked={ec.is_primary}
                                onChange={(e) =>
                                  handleContactChange(i, 'is_primary', e.target.checked)
                                }
                                className="h-4 w-4 text-red-600 focus:ring-red-500 border-theme-surface-border rounded"
                              />
                              Primary
                            </label>
                            <button
                              onClick={() => handleRemoveContact(i)}
                              className="text-red-500 hover:text-red-400 p-1 rounded transition-colors"
                              aria-label={`Remove contact ${i + 1}`}
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor={`contact-name-${i}`} className="block text-sm font-medium text-theme-text-secondary mb-1">
                              Name <span className="text-red-500">*</span>
                            </label>
                            <input
                              id={`contact-name-${i}`}
                              type="text"
                              placeholder="Full name"
                              value={ec.name}
                              onChange={(e) => handleContactChange(i, 'name', e.target.value)}
                              className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                              disabled={savingContacts}
                            />
                          </div>
                          <div>
                            <label htmlFor={`contact-relationship-${i}`} className="block text-sm font-medium text-theme-text-secondary mb-1">
                              Relationship
                            </label>
                            <input
                              id={`contact-relationship-${i}`}
                              type="text"
                              placeholder="e.g., Spouse, Parent"
                              value={ec.relationship}
                              onChange={(e) => handleContactChange(i, 'relationship', e.target.value)}
                              className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                              disabled={savingContacts}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor={`contact-phone-${i}`} className="block text-sm font-medium text-theme-text-secondary mb-1">
                              Phone <span className="text-red-500">*</span>
                            </label>
                            <input
                              id={`contact-phone-${i}`}
                              type="tel"
                              placeholder="Phone number"
                              value={ec.phone}
                              onChange={(e) => handleContactChange(i, 'phone', e.target.value)}
                              className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                              disabled={savingContacts}
                            />
                          </div>
                          <div>
                            <label htmlFor={`contact-email-${i}`} className="block text-sm font-medium text-theme-text-secondary mb-1">
                              Email
                            </label>
                            <input
                              id={`contact-email-${i}`}
                              type="email"
                              placeholder="Email address"
                              value={ec.email || ''}
                              onChange={(e) => handleContactChange(i, 'email', e.target.value)}
                              className="block w-full px-3 py-2 border border-theme-input-border rounded-md bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                              disabled={savingContacts}
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={handleAddContact}
                      className="w-full px-3 py-2.5 text-sm font-medium text-theme-text-secondary border border-dashed border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      Add Another Contact
                    </button>

                    {contactsError && (
                      <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md">
                        <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <p className="text-sm text-red-600 dark:text-red-400">{contactsError}</p>
                      </div>
                    )}

                    <div className="pt-4 border-t border-theme-surface-border">
                      <button
                        onClick={() => { void handleSaveEmergencyContacts(); }}
                        disabled={savingContacts}
                        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {savingContacts ? 'Saving...' : 'Save Emergency Contacts'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Appearance Tab */}
        {activeTab === 'appearance' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-theme-text-primary mb-4">Appearance</h2>
              <p className="text-theme-text-secondary text-sm mb-6">
                Choose how The Logbook looks to you
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-3">
                Theme
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isSelected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setTheme(option.value)}
                      className={`relative flex flex-col items-center p-4 rounded-lg border-2 transition-all focus:outline-none focus:ring-2 focus:ring-red-500 ${
                        isSelected
                          ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                          : 'border-theme-surface-border bg-theme-surface-secondary hover:border-theme-surface-border'
                      }`}
                      aria-pressed={isSelected}
                    >
                      <Icon className={`w-8 h-8 mb-2 ${
                        isSelected
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-theme-text-muted'
                      }`} aria-hidden="true" />
                      <span className={`text-sm font-medium ${
                        isSelected
                          ? 'text-red-700 dark:text-red-300'
                          : 'text-theme-text-secondary'
                      }`}>
                        {option.label}
                      </span>
                      <span className="text-xs text-theme-text-muted mt-1 text-center">
                        {option.description}
                      </span>
                      {isSelected && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle className="w-5 h-5 text-red-500" aria-label="Selected" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-theme-text-primary mb-4">Notification Preferences</h2>
              <p className="text-theme-text-secondary text-sm mb-6">
                Manage how and when you receive notifications
              </p>
            </div>

            <div className="space-y-4">
              {/* Email Notifications Toggle */}
              <div className="flex items-center justify-between py-4 border-b border-theme-surface-border">
                <div>
                  <label htmlFor="emailNotifications" className="text-sm font-medium text-theme-text-primary">
                    Email Notifications
                  </label>
                  <p className="text-sm text-theme-text-secondary">
                    Receive email notifications for important updates
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEmailNotifications(!emailNotifications)}
                  className={`${
                    emailNotifications ? 'bg-red-600' : 'bg-theme-surface-border'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-theme-bg`}
                  role="switch"
                  aria-checked={emailNotifications}
                >
                  <span
                    className={`${
                      emailNotifications ? 'translate-x-5' : 'translate-x-0'
                    } toggle-knob-md`}
                  />
                </button>
              </div>

              {/* Event Reminders Toggle */}
              <div className="flex items-center justify-between py-4 border-b border-theme-surface-border">
                <div>
                  <label htmlFor="eventReminders" className="text-sm font-medium text-theme-text-primary">
                    Event Reminders
                  </label>
                  <p className="text-sm text-theme-text-secondary">
                    Get reminders before scheduled events
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEventReminders(!eventReminders)}
                  className={`${
                    eventReminders ? 'bg-red-600' : 'bg-theme-surface-border'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-theme-bg`}
                  role="switch"
                  aria-checked={eventReminders}
                >
                  <span
                    className={`${
                      eventReminders ? 'translate-x-5' : 'translate-x-0'
                    } toggle-knob-md`}
                  />
                </button>
              </div>

              {/* Training Reminders Toggle */}
              <div className="flex items-center justify-between py-4 border-b border-theme-surface-border">
                <div>
                  <label htmlFor="trainingReminders" className="text-sm font-medium text-theme-text-primary">
                    Training Reminders
                  </label>
                  <p className="text-sm text-theme-text-secondary">
                    Notifications for training deadlines and requirements
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTrainingReminders(!trainingReminders)}
                  className={`${
                    trainingReminders ? 'bg-red-600' : 'bg-theme-surface-border'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-theme-bg`}
                  role="switch"
                  aria-checked={trainingReminders}
                >
                  <span
                    className={`${
                      trainingReminders ? 'translate-x-5' : 'translate-x-0'
                    } toggle-knob-md`}
                  />
                </button>
              </div>

              {/* Announcement Notifications Toggle */}
              <div className="flex items-center justify-between py-4">
                <div>
                  <label htmlFor="announcementNotifications" className="text-sm font-medium text-theme-text-primary">
                    Announcement Notifications
                  </label>
                  <p className="text-sm text-theme-text-secondary">
                    Stay updated with department announcements
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAnnouncementNotifications(!announcementNotifications)}
                  className={`${
                    announcementNotifications ? 'bg-red-600' : 'bg-theme-surface-border'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-theme-bg`}
                  role="switch"
                  aria-checked={announcementNotifications}
                >
                  <span
                    className={`${
                      announcementNotifications ? 'translate-x-5' : 'translate-x-0'
                    } toggle-knob-md`}
                  />
                </button>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={() => { void handleSavePreferences(); }}
                disabled={savingPreferences}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {savingPreferences ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default UserSettingsPage;
