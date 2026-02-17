/**
 * User Settings Page
 *
 * Allows users to manage their personal account settings, password,
 * appearance, and notification preferences.
 */

import React, { useState, useEffect } from 'react';
import { User, Lock, Bell, Eye, EyeOff, CheckCircle, Sun, Moon, Monitor, Palette } from 'lucide-react';
import toast from 'react-hot-toast';
import { authService, userService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { validatePasswordStrength } from '../utils/passwordValidation';
import type { PasswordChangeData } from '../types/auth';
import type { UserProfileUpdate } from '../types/user';
import type { UserWithRoles } from '../types/role';
import { getErrorMessage } from '../utils/errorHandling';

type TabType = 'account' | 'password' | 'appearance' | 'notifications';

export const UserSettingsPage: React.FC = () => {
  const { user } = useAuthStore();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>('account');

  // Profile state
  const [profile, setProfile] = useState<UserWithRoles | null>(null);
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
  const [loadingPreferences, setLoadingPreferences] = useState(false);

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
          badge_number: data.badge_number || '',
          rank: data.rank || '',
          station: data.station || '',
          address_street: data.address_street || '',
          address_city: data.address_city || '',
          address_state: data.address_state || '',
          address_zip: data.address_zip || '',
          address_country: data.address_country || 'USA',
        });
      } catch {
        // Profile load failure is non-critical for other tabs
      } finally {
        setLoadingProfile(false);
      }
    };
    loadProfile();
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
    loadPreferences();
  }, [user?.id]);

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    setSavingProfile(true);
    try {
      const updated = await userService.updateUserProfile(user.id, profileForm);
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
    { id: 'appearance' as TabType, label: 'Appearance', icon: Palette },
    { id: 'notifications' as TabType, label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">User Settings</h1>
        <p className="text-slate-500 dark:text-slate-300">Manage your account settings and preferences</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-white/10 mb-6">
        <nav className="flex space-x-6" aria-label="Settings tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 pb-4 px-1 border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  activeTab === tab.id
                    ? 'border-red-500 text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
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
      <div className="bg-white dark:bg-white/10 backdrop-blur-sm border border-slate-200 dark:border-white/20 rounded-lg p-6">
        {/* Account Tab */}
        {activeTab === 'account' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">Account Information</h2>
              <p className="text-slate-500 dark:text-slate-300 text-sm mb-6">
                Update your personal details and contact information
              </p>
            </div>

            {loadingProfile ? (
              <div className="flex justify-center items-center h-32">
                <div className="text-slate-400">Loading profile...</div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Personal Information */}
                <div>
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wider">Personal Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="firstName" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">First Name</label>
                      <input
                        id="firstName"
                        type="text"
                        value={profileForm.first_name || ''}
                        onChange={(e) => handleProfileChange('first_name', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div>
                      <label htmlFor="middleName" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Middle Name</label>
                      <input
                        id="middleName"
                        type="text"
                        value={profileForm.middle_name || ''}
                        onChange={(e) => handleProfileChange('middle_name', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div>
                      <label htmlFor="lastName" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Last Name</label>
                      <input
                        id="lastName"
                        type="text"
                        value={profileForm.last_name || ''}
                        onChange={(e) => handleProfileChange('last_name', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div>
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wider">Contact Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="phone" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Phone</label>
                      <input
                        id="phone"
                        type="tel"
                        value={profileForm.phone || ''}
                        onChange={(e) => handleProfileChange('phone', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div>
                      <label htmlFor="mobile" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Mobile</label>
                      <input
                        id="mobile"
                        type="tel"
                        value={profileForm.mobile || ''}
                        onChange={(e) => handleProfileChange('mobile', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                  </div>
                </div>

                {/* Department Information */}
                <div>
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wider">Department Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="badgeNumber" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Badge Number</label>
                      <input
                        id="badgeNumber"
                        type="text"
                        value={profileForm.badge_number || ''}
                        onChange={(e) => handleProfileChange('badge_number', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div>
                      <label htmlFor="rank" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Rank</label>
                      <input
                        id="rank"
                        type="text"
                        value={profileForm.rank || ''}
                        onChange={(e) => handleProfileChange('rank', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div>
                      <label htmlFor="station" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Station</label>
                      <input
                        id="station"
                        type="text"
                        value={profileForm.station || ''}
                        onChange={(e) => handleProfileChange('station', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                  </div>
                </div>

                {/* Address */}
                <div>
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wider">Address</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="addressStreet" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Street Address</label>
                      <input
                        id="addressStreet"
                        type="text"
                        value={profileForm.address_street || ''}
                        onChange={(e) => handleProfileChange('address_street', e.target.value)}
                        className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                        disabled={savingProfile}
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="col-span-2 sm:col-span-1">
                        <label htmlFor="addressCity" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">City</label>
                        <input
                          id="addressCity"
                          type="text"
                          value={profileForm.address_city || ''}
                          onChange={(e) => handleProfileChange('address_city', e.target.value)}
                          className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                      <div>
                        <label htmlFor="addressState" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">State</label>
                        <input
                          id="addressState"
                          type="text"
                          value={profileForm.address_state || ''}
                          onChange={(e) => handleProfileChange('address_state', e.target.value)}
                          className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                      <div>
                        <label htmlFor="addressZip" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">ZIP Code</label>
                        <input
                          id="addressZip"
                          type="text"
                          value={profileForm.address_zip || ''}
                          onChange={(e) => handleProfileChange('address_zip', e.target.value)}
                          className="block w-full px-3 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                          disabled={savingProfile}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <div className="pt-4 border-t border-slate-200 dark:border-white/10">
                  <button
                    onClick={handleSaveProfile}
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
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">Change Password</h2>
              <p className="text-slate-500 dark:text-slate-300 text-sm mb-6">
                Update your password to keep your account secure
              </p>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-4">
              {/* Current Password */}
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  Current Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  </div>
                  <input
                    id="currentPassword"
                    name="currentPassword"
                    type={showCurrentPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    className="block w-full pl-10 pr-10 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                    placeholder="Enter current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 dark:hover:text-white focus:outline-none"
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
                <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  </div>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    className="block w-full pl-10 pr-10 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 dark:hover:text-white focus:outline-none"
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
                    <p className="text-xs text-slate-500 dark:text-slate-300 font-medium">Password must contain:</p>
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
                            <div className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-500 flex-shrink-0" aria-hidden="true" />
                          )}
                          <span className={check.valid ? 'text-green-600 dark:text-green-300' : 'text-slate-400'}>
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
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  </div>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    className="block w-full pl-10 pr-10 py-2 border border-slate-300 dark:border-white/20 rounded-md bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent sm:text-sm"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 dark:hover:text-white focus:outline-none"
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

        {/* Appearance Tab */}
        {activeTab === 'appearance' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">Appearance</h2>
              <p className="text-slate-500 dark:text-slate-300 text-sm mb-6">
                Choose how The Logbook looks to you
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">
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
                          : 'border-slate-200 dark:border-white/20 bg-slate-50 dark:bg-white/5 hover:border-slate-300 dark:hover:border-white/30'
                      }`}
                      aria-pressed={isSelected}
                    >
                      <Icon className={`w-8 h-8 mb-2 ${
                        isSelected
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`} aria-hidden="true" />
                      <span className={`text-sm font-medium ${
                        isSelected
                          ? 'text-red-700 dark:text-red-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}>
                        {option.label}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">
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
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">Notification Preferences</h2>
              <p className="text-slate-500 dark:text-slate-300 text-sm mb-6">
                Manage how and when you receive notifications
              </p>
            </div>

            <div className="space-y-4">
              {/* Email Notifications Toggle */}
              <div className="flex items-center justify-between py-4 border-b border-slate-200 dark:border-white/10">
                <div>
                  <label htmlFor="emailNotifications" className="text-sm font-medium text-slate-900 dark:text-white">
                    Email Notifications
                  </label>
                  <p className="text-sm text-slate-500 dark:text-slate-300">
                    Receive email notifications for important updates
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEmailNotifications(!emailNotifications)}
                  className={`${
                    emailNotifications ? 'bg-red-600' : 'bg-slate-300 dark:bg-slate-600'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900`}
                  role="switch"
                  aria-checked={emailNotifications}
                >
                  <span
                    className={`${
                      emailNotifications ? 'translate-x-5' : 'translate-x-0'
                    } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>

              {/* Event Reminders Toggle */}
              <div className="flex items-center justify-between py-4 border-b border-slate-200 dark:border-white/10">
                <div>
                  <label htmlFor="eventReminders" className="text-sm font-medium text-slate-900 dark:text-white">
                    Event Reminders
                  </label>
                  <p className="text-sm text-slate-500 dark:text-slate-300">
                    Get reminders before scheduled events
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEventReminders(!eventReminders)}
                  className={`${
                    eventReminders ? 'bg-red-600' : 'bg-slate-300 dark:bg-slate-600'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900`}
                  role="switch"
                  aria-checked={eventReminders}
                >
                  <span
                    className={`${
                      eventReminders ? 'translate-x-5' : 'translate-x-0'
                    } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>

              {/* Training Reminders Toggle */}
              <div className="flex items-center justify-between py-4 border-b border-slate-200 dark:border-white/10">
                <div>
                  <label htmlFor="trainingReminders" className="text-sm font-medium text-slate-900 dark:text-white">
                    Training Reminders
                  </label>
                  <p className="text-sm text-slate-500 dark:text-slate-300">
                    Notifications for training deadlines and requirements
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTrainingReminders(!trainingReminders)}
                  className={`${
                    trainingReminders ? 'bg-red-600' : 'bg-slate-300 dark:bg-slate-600'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900`}
                  role="switch"
                  aria-checked={trainingReminders}
                >
                  <span
                    className={`${
                      trainingReminders ? 'translate-x-5' : 'translate-x-0'
                    } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>

              {/* Announcement Notifications Toggle */}
              <div className="flex items-center justify-between py-4">
                <div>
                  <label htmlFor="announcementNotifications" className="text-sm font-medium text-slate-900 dark:text-white">
                    Announcement Notifications
                  </label>
                  <p className="text-sm text-slate-500 dark:text-slate-300">
                    Stay updated with department announcements
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAnnouncementNotifications(!announcementNotifications)}
                  className={`${
                    announcementNotifications ? 'bg-red-600' : 'bg-slate-300 dark:bg-slate-600'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900`}
                  role="switch"
                  aria-checked={announcementNotifications}
                >
                  <span
                    className={`${
                      announcementNotifications ? 'translate-x-5' : 'translate-x-0'
                    } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={handleSavePreferences}
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
