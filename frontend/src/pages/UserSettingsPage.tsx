/**
 * User Settings Page
 *
 * Allows users to manage their personal account settings, password,
 * appearance, and notification preferences.
 */

import React, { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import {
  User,
  Lock,
  Bell,
  Eye,
  EyeOff,
  CheckCircle,
  Sun,
  Moon,
  Monitor,
  Contrast,
  Palette,
  AlertTriangle,
  Heart,
  Plus,
  Trash2,
  ShieldCheck,
  Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { authService, userService } from '../services/api';
import { MfaSettingsCard } from '../components/settings/MfaSettingsCard';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { validatePasswordStrength } from '../utils/passwordValidation';
import type { PasswordChangeData } from '../types/auth';
import type { UserProfileUpdate, EmergencyContact, ConsentItem } from '../types/user';
import type { UserWithRoles } from '../types/role';
import { getErrorMessage } from '../utils/errorHandling';
import { useRanks } from '../hooks/useRanks';
import { usePushNotifications } from '../hooks/usePushNotifications';

type TabType = 'account' | 'password' | 'security' | 'emergency' | 'appearance' | 'notifications';

const TAB_IDS: TabType[] = ['account', 'password', 'security', 'emergency', 'appearance', 'notifications'];

export const UserSettingsPage: React.FC = () => {
  const { user, loadUser } = useAuthStore();
  const { rankOptions } = useRanks();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const forcePasswordChange =
    (location.state as { forcePasswordChange?: boolean } | null)?.forcePasswordChange ||
    user?.must_change_password ||
    user?.password_expired;
  const forceMfaSetup =
    (location.state as { forceMfaSetup?: boolean } | null)?.forceMfaSetup || user?.mfa_enrollment_required;
  // Deep links land here from the department setup checklist
  // (/account?tab=security for the MFA step), so honor ?tab= — but never over
  // a forced password change or MFA enrollment, which must not be navigated
  // away from.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialTab: TabType = TAB_IDS.includes(requestedTab as TabType) ? (requestedTab as TabType) : 'account';
  const [activeTab, setActiveTab] = useState<TabType>(
    forcePasswordChange ? 'password' : forceMfaSetup ? 'security' : initialTab
  );

  // Profile state
  const [_profile, setProfile] = useState<UserWithRoles | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [downloadingData, setDownloadingData] = useState(false);
  const [consents, setConsents] = useState<ConsentItem[]>([]);
  const [savingConsent, setSavingConsent] = useState<string | null>(null);
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
  // Per-device web push; separate from the account-level email/SMS prefs below
  // because a subscription belongs to this browser, not to the user record.
  const push = usePushNotifications();
  const [smsNotifications, setSmsNotifications] = useState(true);
  const [eventReminders, setEventReminders] = useState(true);
  const [trainingReminders, setTrainingReminders] = useState(true);
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
          data.emergency_contacts?.length ? data.emergency_contacts.map((ec: EmergencyContact) => ({ ...ec })) : []
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
        setSmsNotifications(prefs.sms_notifications ?? true);
        setEventReminders(prefs.event_reminders ?? true);
        setTrainingReminders(prefs.training_reminders ?? true);
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
      toast.error(getErrorMessage(err, 'Failed to change password. Please check your current password and try again.'));
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
        sms_notifications: smsNotifications,
        event_reminders: eventReminders,
        training_reminders: trainingReminders,
      });

      toast.success('Preferences saved successfully!');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save preferences. Please try again.'));
    } finally {
      setSavingPreferences(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'security') return;
    userService
      .getMyConsents()
      .then(setConsents)
      .catch(() => {
        // Section renders empty on failure; toggling still surfaces errors.
      });
  }, [activeTab]);

  const CONSENT_LABELS: Record<string, { title: string; description: string }> = {
    photo_use: {
      title: 'Photo use',
      description: 'Allow the department to use your photo in publications, social media, and other public material.',
    },
    public_roster_listing: {
      title: 'Public roster listing',
      description: 'Show your name and rank on the public website roster.',
    },
    sms_notifications: {
      title: 'Text message notifications',
      description: 'Receive department notifications by SMS at your mobile number.',
    },
  };

  const handleConsentToggle = async (consentType: string, granted: boolean) => {
    setSavingConsent(consentType);
    try {
      await userService.setMyConsent(consentType, granted);
      setConsents((prev) => prev.map((c) => (c.consent_type === consentType ? { ...c, granted } : c)));
      toast.success('Privacy choice saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save your choice'));
    } finally {
      setSavingConsent(null);
    }
  };

  const handleDownloadMyData = async () => {
    setDownloadingData(true);
    try {
      const blob = await userService.downloadMyData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'logbook-personal-data-export.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Your data export has been downloaded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not prepare your data export. Try again later.'));
    } finally {
      setDownloadingData(false);
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

  const handleContactChange = (index: number, field: keyof EmergencyContact, value: string | boolean) => {
    setContactsForm((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
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
        updated.emergency_contacts?.length ? updated.emergency_contacts.map((ec: EmergencyContact) => ({ ...ec })) : []
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
    {
      value: 'high-contrast' as const,
      label: 'High Contrast',
      description: 'Maximum visibility for accessibility',
      icon: Contrast,
    },
  ];

  const tabs = [
    { id: 'account' as TabType, label: 'Account', icon: User },
    { id: 'password' as TabType, label: 'Password', icon: Lock },
    { id: 'security' as TabType, label: 'Security', icon: ShieldCheck },
    { id: 'emergency' as TabType, label: 'Emergency Contacts', icon: Heart },
    { id: 'appearance' as TabType, label: 'Appearance', icon: Palette },
    { id: 'notifications' as TabType, label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-theme-text-primary mb-2 text-3xl font-bold">User Settings</h1>
          <p className="text-theme-text-secondary">Manage your account settings and preferences</p>
        </div>

        {/* Tabs */}
        <div className="border-theme-surface-border -mx-4 mb-6 border-b px-4 sm:mx-0 sm:px-0">
          <nav className="flex scrollbar-thin space-x-4 overflow-x-auto sm:space-x-6" aria-label="Settings tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`focus:ring-theme-focus-ring flex items-center space-x-2 border-b-2 px-1 pb-4 whitespace-nowrap transition-colors focus:ring-2 focus:outline-hidden ${
                    activeTab === tab.id
                      ? 'text-theme-text-primary border-red-500'
                      : 'text-theme-text-muted hover:text-theme-text-primary border-transparent'
                  }`}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span className="font-medium">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="card p-4 sm:p-6">
          {/* Account Tab */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Account Information</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">
                  Update your personal details and contact information
                </p>
              </div>

              {loadingProfile ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="text-theme-text-muted">Loading profile...</div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Personal Information */}
                  <div>
                    <h3 className="text-theme-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
                      Personal Information
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label htmlFor="firstName" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          First Name
                        </label>
                        <input
                          id="firstName"
                          type="text"
                          value={profileForm.first_name || ''}
                          onChange={(e) => handleProfileChange('first_name', e.target.value)}
                          className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="middleName"
                          className="text-theme-text-secondary mb-1 block text-sm font-medium"
                        >
                          Middle Name
                        </label>
                        <input
                          id="middleName"
                          type="text"
                          value={profileForm.middle_name || ''}
                          onChange={(e) => handleProfileChange('middle_name', e.target.value)}
                          className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                      <div>
                        <label htmlFor="lastName" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          Last Name
                        </label>
                        <input
                          id="lastName"
                          type="text"
                          value={profileForm.last_name || ''}
                          onChange={(e) => handleProfileChange('last_name', e.target.value)}
                          className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div>
                    <h3 className="text-theme-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
                      Contact Information
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="phone" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          Phone
                        </label>
                        <input
                          id="phone"
                          type="tel"
                          value={profileForm.phone || ''}
                          onChange={(e) => handleProfileChange('phone', e.target.value)}
                          className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                      <div>
                        <label htmlFor="mobile" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          Mobile
                        </label>
                        <input
                          id="mobile"
                          type="tel"
                          value={profileForm.mobile || ''}
                          onChange={(e) => handleProfileChange('mobile', e.target.value)}
                          className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Department Information */}
                  <div>
                    <h3 className="text-theme-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
                      Department Information
                    </h3>
                    <p className="text-theme-text-muted mb-3 text-xs">
                      These fields can only be changed by a Membership Coordinator from the Members admin page.
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label
                          htmlFor="membershipNumber"
                          className="text-theme-text-secondary mb-1 block text-sm font-medium"
                        >
                          Membership Number
                        </label>
                        <input
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          id="membershipNumber"
                          type="text"
                          value={profileForm.membership_number || ''}
                          readOnly
                          className="border-theme-input-border bg-theme-surface-secondary text-theme-text-primary placeholder-theme-text-muted block w-full cursor-not-allowed rounded-md border px-3 py-2 opacity-60 sm:text-sm"
                          disabled
                        />
                      </div>
                      <div>
                        <label htmlFor="rank" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          Rank
                        </label>
                        <input
                          id="rank"
                          type="text"
                          value={
                            rankOptions.find((r) => r.value === profileForm.rank)?.label || profileForm.rank || '—'
                          }
                          readOnly
                          className="border-theme-input-border bg-theme-surface-secondary text-theme-text-primary block w-full cursor-not-allowed rounded-md border px-3 py-2 opacity-60 sm:text-sm"
                          disabled
                        />
                      </div>
                      <div>
                        <label htmlFor="station" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          Station
                        </label>
                        <input
                          id="station"
                          type="text"
                          value={profileForm.station || ''}
                          readOnly
                          className="border-theme-input-border bg-theme-surface-secondary text-theme-text-primary placeholder-theme-text-muted block w-full cursor-not-allowed rounded-md border px-3 py-2 opacity-60 sm:text-sm"
                          disabled
                        />
                      </div>
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <h3 className="text-theme-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
                      Address
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label
                          htmlFor="addressStreet"
                          className="text-theme-text-secondary mb-1 block text-sm font-medium"
                        >
                          Street Address
                        </label>
                        <input
                          id="addressStreet"
                          type="text"
                          value={profileForm.address_street || ''}
                          onChange={(e) => handleProfileChange('address_street', e.target.value)}
                          className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <div className="col-span-2 sm:col-span-1">
                          <label
                            htmlFor="addressCity"
                            className="text-theme-text-secondary mb-1 block text-sm font-medium"
                          >
                            City
                          </label>
                          <input
                            id="addressCity"
                            type="text"
                            value={profileForm.address_city || ''}
                            onChange={(e) => handleProfileChange('address_city', e.target.value)}
                            className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                            disabled={savingProfile}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="addressState"
                            className="text-theme-text-secondary mb-1 block text-sm font-medium"
                          >
                            State
                          </label>
                          <input
                            id="addressState"
                            type="text"
                            value={profileForm.address_state || ''}
                            onChange={(e) => handleProfileChange('address_state', e.target.value)}
                            className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                            disabled={savingProfile}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="addressZip"
                            className="text-theme-text-secondary mb-1 block text-sm font-medium"
                          >
                            ZIP Code
                          </label>
                          <input
                            id="addressZip"
                            type="text"
                            value={profileForm.address_zip || ''}
                            onChange={(e) => handleProfileChange('address_zip', e.target.value)}
                            className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                            disabled={savingProfile}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="border-theme-surface-border border-t pt-4">
                    <button
                      onClick={() => {
                        void handleSaveProfile();
                      }}
                      disabled={savingProfile}
                      className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
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
                <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-500/30 dark:bg-yellow-500/10">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Password change required</p>
                    <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-400">
                      Your administrator has required you to change your password before continuing. Please set a new
                      password below.
                    </p>
                  </div>
                </div>
              )}
              <div>
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Change Password</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">
                  Update your password to keep your account secure
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  void handlePasswordChange(e);
                }}
                className="space-y-4"
              >
                {/* Current Password */}
                <div>
                  <label htmlFor="currentPassword" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Current Password
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Lock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                    </div>
                    <input
                      id="currentPassword"
                      name="currentPassword"
                      type={showCurrentPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border py-2 pr-10 pl-10 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      disabled={changingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-hidden"
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
                  <label htmlFor="newPassword" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    New Password
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Lock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                    </div>
                    <input
                      id="newPassword"
                      name="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border py-2 pr-10 pl-10 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={changingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-hidden"
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
                      <p className="text-theme-text-secondary text-xs font-medium">Password must contain:</p>
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
                              <CheckCircle
                                className="h-4 w-4 shrink-0 text-green-500 dark:text-green-400"
                                aria-hidden="true"
                              />
                            ) : (
                              <div
                                className="border-theme-surface-border h-4 w-4 shrink-0 rounded-full border-2"
                                aria-hidden="true"
                              />
                            )}
                            <span
                              className={check.valid ? 'text-green-600 dark:text-green-300' : 'text-theme-text-muted'}
                            >
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
                  <label htmlFor="confirmPassword" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Lock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                    </div>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border py-2 pr-10 pl-10 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={changingPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="text-theme-text-muted hover:text-theme-text-primary absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-hidden"
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
                    className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
                  >
                    {changingPassword ? 'Changing Password...' : 'Change Password'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Security (MFA) Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Two-Factor Authentication</h2>
                <p className="text-theme-text-secondary mb-4 text-sm">
                  Add a second step at sign-in using an authenticator app.
                </p>
                <MfaSettingsCard
                  onChange={() => {
                    void useAuthStore.getState().loadUser();
                  }}
                />
              </div>

              <div className="border-theme-surface-border border-t pt-6">
                <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Privacy Choices</h2>
                <p className="text-theme-text-secondary mb-4 text-sm">
                  These are optional — nothing here is required for membership. If you have never answered, the
                  department treats it as a no.
                </p>
                <div className="space-y-4">
                  {consents.map((consent) => {
                    const label = CONSENT_LABELS[consent.consent_type];
                    if (!label) return null;
                    return (
                      <label key={consent.consent_type} className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={consent.granted === true}
                          disabled={savingConsent === consent.consent_type}
                          onChange={(e) => void handleConsentToggle(consent.consent_type, e.target.checked)}
                          className="mt-1 h-4 w-4"
                        />
                        <span>
                          <span className="text-theme-text-primary block text-sm font-medium">
                            {label.title}
                            {consent.granted === null && (
                              <span className="text-theme-text-muted ml-2 text-xs font-normal">(not answered)</span>
                            )}
                          </span>
                          <span className="text-theme-text-secondary block text-sm">{label.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="border-theme-surface-border border-t pt-6">
                <h2 className="text-theme-text-primary mb-1 text-xl font-semibold">Your Data</h2>
                <p className="text-theme-text-secondary mb-4 text-sm">
                  Download a copy of everything the department stores about you — profile, training history, attendance,
                  and related records — as a JSON file.
                </p>
                <button
                  type="button"
                  onClick={() => void handleDownloadMyData()}
                  disabled={downloadingData}
                  className="btn-primary inline-flex items-center gap-2 rounded-md text-sm font-medium disabled:opacity-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {downloadingData ? 'Preparing export…' : 'Download my data'}
                </button>
              </div>
            </div>
          )}

          {/* Emergency Contacts Tab */}
          {activeTab === 'emergency' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Emergency Contacts</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">
                  Add emergency contacts so your department can reach someone on your behalf if needed
                </p>
              </div>

              {loadingProfile ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="text-theme-text-muted">Loading contacts...</div>
                </div>
              ) : (
                <div className="space-y-4">
                  {contactsForm.length === 0 ? (
                    <div className="border-theme-surface-border rounded-lg border border-dashed py-8 text-center">
                      <Heart className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
                      <p className="text-theme-text-muted mb-4 text-sm">No emergency contacts on file.</p>
                      <button
                        onClick={handleAddContact}
                        className="btn-primary inline-flex items-center gap-2 rounded-md text-sm font-medium"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add Emergency Contact
                      </button>
                    </div>
                  ) : (
                    <>
                      {contactsForm.map((ec, i) => (
                        <div key={i} className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-theme-text-secondary text-sm font-medium">Contact {i + 1}</span>
                            <div className="flex items-center gap-3">
                              <label className="text-theme-text-secondary flex cursor-pointer items-center gap-1.5 text-sm">
                                <input
                                  type="checkbox"
                                  checked={ec.is_primary}
                                  onChange={(e) => handleContactChange(i, 'is_primary', e.target.checked)}
                                  className="form-checkbox border-theme-surface-border"
                                />
                                Primary
                              </label>
                              <button
                                onClick={() => handleRemoveContact(i)}
                                className="rounded-sm p-1 text-red-500 transition-colors hover:text-red-800 dark:hover:text-red-400"
                                aria-label={`Remove contact ${i + 1}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor={`contact-name-${i}`}
                                className="text-theme-text-secondary mb-1 block text-sm font-medium"
                              >
                                Name <span className="text-red-500">*</span>
                              </label>
                              <input
                                id={`contact-name-${i}`}
                                type="text"
                                placeholder="Full name"
                                value={ec.name}
                                onChange={(e) => handleContactChange(i, 'name', e.target.value)}
                                className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                                disabled={savingContacts}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`contact-relationship-${i}`}
                                className="text-theme-text-secondary mb-1 block text-sm font-medium"
                              >
                                Relationship
                              </label>
                              <input
                                id={`contact-relationship-${i}`}
                                type="text"
                                placeholder="e.g., Spouse, Parent"
                                value={ec.relationship}
                                onChange={(e) => handleContactChange(i, 'relationship', e.target.value)}
                                className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                                disabled={savingContacts}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor={`contact-phone-${i}`}
                                className="text-theme-text-secondary mb-1 block text-sm font-medium"
                              >
                                Phone <span className="text-red-500">*</span>
                              </label>
                              <input
                                id={`contact-phone-${i}`}
                                type="tel"
                                placeholder="Phone number"
                                value={ec.phone}
                                onChange={(e) => handleContactChange(i, 'phone', e.target.value)}
                                className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                                disabled={savingContacts}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`contact-email-${i}`}
                                className="text-theme-text-secondary mb-1 block text-sm font-medium"
                              >
                                Email
                              </label>
                              <input
                                id={`contact-email-${i}`}
                                type="email"
                                placeholder="Email address"
                                value={ec.email || ''}
                                onChange={(e) => handleContactChange(i, 'email', e.target.value)}
                                className="border-theme-input-border bg-theme-input-bg text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring block w-full rounded-md border px-3 py-2 focus:border-transparent focus:ring-2 focus:outline-hidden sm:text-sm"
                                disabled={savingContacts}
                              />
                            </div>
                          </div>
                        </div>
                      ))}

                      <button
                        onClick={handleAddContact}
                        className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm font-medium transition-colors"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add Another Contact
                      </button>

                      {contactsError && (
                        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
                          <p className="text-sm text-red-600 dark:text-red-400">{contactsError}</p>
                        </div>
                      )}

                      <div className="border-theme-surface-border border-t pt-4">
                        <button
                          onClick={() => {
                            void handleSaveEmergencyContacts();
                          }}
                          disabled={savingContacts}
                          className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
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
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Appearance</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">Choose how The Logbook looks to you</p>
              </div>

              <div>
                <label className="text-theme-text-secondary mb-3 block text-sm font-medium">Theme</label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const isSelected = theme === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={`focus:ring-theme-focus-ring relative flex flex-col items-center rounded-lg border-2 p-4 transition-all focus:ring-2 focus:outline-hidden ${
                          isSelected
                            ? 'border-theme-accent-red bg-theme-accent-red-muted'
                            : 'border-theme-surface-border bg-theme-surface-secondary hover:border-theme-surface-border'
                        }`}
                        aria-pressed={isSelected}
                      >
                        <Icon
                          className={`mb-2 h-8 w-8 ${isSelected ? 'text-theme-accent-red' : 'text-theme-text-muted'}`}
                          aria-hidden="true"
                        />
                        <span
                          className={`text-sm font-medium ${
                            isSelected ? 'text-theme-accent-red' : 'text-theme-text-secondary'
                          }`}
                        >
                          {option.label}
                        </span>
                        <span className="text-theme-text-muted mt-1 text-center text-xs">{option.description}</span>
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <CheckCircle className="text-theme-accent-red h-5 w-5" aria-label="Selected" />
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
                <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">Notification Preferences</h2>
                <p className="text-theme-text-secondary mb-6 text-sm">Manage how and when you receive notifications</p>
              </div>

              <div className="space-y-4">
                {/* Push Notifications Toggle — hidden entirely unless this
                  browser supports push AND the server has VAPID keys. On iOS
                  the API only exists once the PWA is on the home screen, so a
                  member browsing in Safari correctly sees nothing here. */}
                {push.supported && (
                  <div className="border-theme-surface-border flex items-center justify-between border-b py-4">
                    <div className="pr-4">
                      <span className="text-theme-text-primary text-sm font-medium">
                        Push Notifications on This Device
                      </span>
                      <p className="text-theme-text-secondary text-sm">
                        Get alerts on your lock screen even when The Logbook is closed. Enabled per device, so turn it
                        on wherever you want to be reached.
                      </p>
                      {push.error && (
                        <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
                          {push.error}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={push.busy}
                      onClick={() => {
                        void (push.subscribed ? push.unsubscribe() : push.subscribe());
                      }}
                      className={`${
                        push.subscribed ? 'bg-red-600' : 'bg-theme-surface-border'
                      } focus:ring-theme-focus-ring focus:ring-offset-theme-bg relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:opacity-50`}
                      role="switch"
                      aria-checked={push.subscribed}
                      aria-label="Push notifications on this device"
                    >
                      <span className={`${push.subscribed ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
                    </button>
                  </div>
                )}

                {/* Email Notifications Toggle */}
                <div className="border-theme-surface-border flex items-center justify-between border-b py-4">
                  <div>
                    <label htmlFor="emailNotifications" className="text-theme-text-primary text-sm font-medium">
                      Email Notifications
                    </label>
                    <p className="text-theme-text-secondary text-sm">
                      Receive email for reminders and alerts. Department announcements are always emailed to you.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEmailNotifications(!emailNotifications)}
                    className={`${
                      emailNotifications ? 'bg-red-600' : 'bg-theme-surface-border'
                    } focus:ring-theme-focus-ring focus:ring-offset-theme-bg relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-offset-2 focus:outline-hidden`}
                    role="switch"
                    aria-checked={emailNotifications}
                  >
                    <span className={`${emailNotifications ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
                  </button>
                </div>

                {/* SMS Notifications Toggle */}
                <div className="border-theme-surface-border flex items-center justify-between border-b py-4">
                  <div>
                    <label htmlFor="smsNotifications" className="text-theme-text-primary text-sm font-medium">
                      Urgent Text Messages
                    </label>
                    <p className="text-theme-text-secondary text-sm">
                      Receive a text for messages marked urgent (requires a mobile number on file)
                    </p>
                  </div>
                  <button
                    type="button"
                    id="smsNotifications"
                    onClick={() => setSmsNotifications(!smsNotifications)}
                    className={`${
                      smsNotifications ? 'bg-red-600' : 'bg-theme-surface-border'
                    } focus:ring-theme-focus-ring focus:ring-offset-theme-bg relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-offset-2 focus:outline-hidden`}
                    role="switch"
                    aria-checked={smsNotifications}
                  >
                    <span className={`${smsNotifications ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
                  </button>
                </div>

                {/* Event Reminders Toggle */}
                <div className="border-theme-surface-border flex items-center justify-between border-b py-4">
                  <div>
                    <label htmlFor="eventReminders" className="text-theme-text-primary text-sm font-medium">
                      Event Reminders
                    </label>
                    <p className="text-theme-text-secondary text-sm">Get reminders before scheduled events</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEventReminders(!eventReminders)}
                    className={`${
                      eventReminders ? 'bg-red-600' : 'bg-theme-surface-border'
                    } focus:ring-theme-focus-ring focus:ring-offset-theme-bg relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-offset-2 focus:outline-hidden`}
                    role="switch"
                    aria-checked={eventReminders}
                  >
                    <span className={`${eventReminders ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
                  </button>
                </div>

                {/* Training Reminders Toggle */}
                <div className="border-theme-surface-border flex items-center justify-between border-b py-4">
                  <div>
                    <label htmlFor="trainingReminders" className="text-theme-text-primary text-sm font-medium">
                      Training Reminders
                    </label>
                    <p className="text-theme-text-secondary text-sm">
                      Notifications for training deadlines and requirements
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTrainingReminders(!trainingReminders)}
                    className={`${
                      trainingReminders ? 'bg-red-600' : 'bg-theme-surface-border'
                    } focus:ring-theme-focus-ring focus:ring-offset-theme-bg relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-offset-2 focus:outline-hidden`}
                    role="switch"
                    aria-checked={trainingReminders}
                  >
                    <span className={`${trainingReminders ? 'translate-x-5' : 'translate-x-0'} toggle-knob-md`} />
                  </button>
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={() => {
                    void handleSavePreferences();
                  }}
                  disabled={savingPreferences}
                  className="btn-primary flex w-full justify-center rounded-md text-sm font-medium disabled:cursor-not-allowed"
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
