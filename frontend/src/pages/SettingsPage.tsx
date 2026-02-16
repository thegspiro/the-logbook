/**
 * Settings Page
 *
 * Allows secretary to manage contact information visibility settings
 * and membership ID configuration.
 */

import React, { useEffect, useState } from 'react';
import { organizationService } from '../services/api';
import type { ContactInfoSettings, MembershipIdSettings } from '../types/user';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<ContactInfoSettings>({
    enabled: false,
    show_email: true,
    show_phone: true,
    show_mobile: true,
  });
  const [membershipIdSettings, setMembershipIdSettings] = useState<MembershipIdSettings>({
    enabled: false,
    prefix: '',
    next_number: 1,
    zero_pad: 3,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingMembership, setSavingMembership] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        setError(null);

        const data = await organizationService.getSettings();
        setSettings(data.contact_info_visibility);
        if (data.membership_ids) {
          setMembershipIdSettings(data.membership_ids);
        }
      } catch (err) {
        setError('Unable to load settings. Please check your connection and refresh the page.');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      await organizationService.updateContactInfoSettings(settings);

      setSuccessMessage('Settings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('Unable to save settings. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMembershipIds = async () => {
    try {
      setSavingMembership(true);
      setError(null);
      setSuccessMessage(null);

      await organizationService.updateMembershipIdSettings(membershipIdSettings);

      setSuccessMessage('Membership ID settings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('Unable to save membership ID settings. Please try again.');
    } finally {
      setSavingMembership(false);
    }
  };

  const handleToggle = (field: keyof ContactInfoSettings) => {
    setSettings((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  // Preview the next membership number that will be assigned
  const previewNextNumber = () => {
    const numStr = String(membershipIdSettings.next_number).padStart(membershipIdSettings.zero_pad, '0');
    return `${membershipIdSettings.prefix}${numStr}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="text-theme-text-muted">Loading settings...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-theme-text-primary">Organization Settings</h2>
          <p className="mt-1 text-sm text-theme-text-muted">
            Manage contact information visibility and membership ID configuration.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-700 dark:text-red-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-green-700 dark:text-green-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-green-700">{successMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Contact Information Visibility */}
        <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-theme-text-primary mb-4">
            Contact Information Visibility
          </h3>
          <p className="text-sm text-theme-text-muted mb-6">
            Control whether contact information is displayed on the member list page.
            When enabled, a privacy notice will be shown to remind users that this information
            is for department purposes only.
          </p>

          <div className="space-y-4">
            {/* Master Toggle */}
            <div className="flex items-center justify-between py-4 border-b border-theme-surface-border">
              <div>
                <label htmlFor="enabled" className="text-sm font-medium text-theme-text-primary">
                  Show Contact Information
                </label>
                <p className="text-sm text-theme-text-muted">
                  Enable display of contact information for all members
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('enabled')}
                className={`${
                  settings.enabled ? 'bg-blue-600' : 'bg-slate-600'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                role="switch"
                aria-checked={settings.enabled}
              >
                <span
                  className={`${
                    settings.enabled ? 'translate-x-5' : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>

            {/* Individual Field Toggles (only shown when enabled) */}
            {settings.enabled && (
              <div className="pl-4 space-y-4">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <label htmlFor="show_email" className="text-sm font-medium text-theme-text-primary">
                      Show Email Addresses
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle('show_email')}
                    className={`${
                      settings.show_email ? 'bg-blue-600' : 'bg-slate-600'
                    } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                    role="switch"
                    aria-checked={settings.show_email}
                  >
                    <span
                      className={`${
                        settings.show_email ? 'translate-x-5' : 'translate-x-0'
                      } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <label htmlFor="show_phone" className="text-sm font-medium text-theme-text-primary">
                      Show Phone Numbers
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle('show_phone')}
                    className={`${
                      settings.show_phone ? 'bg-blue-600' : 'bg-slate-600'
                    } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                    role="switch"
                    aria-checked={settings.show_phone}
                  >
                    <span
                      className={`${
                        settings.show_phone ? 'translate-x-5' : 'translate-x-0'
                      } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <label htmlFor="show_mobile" className="text-sm font-medium text-theme-text-primary">
                      Show Mobile Numbers
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle('show_mobile')}
                    className={`${
                      settings.show_mobile ? 'bg-blue-600' : 'bg-slate-600'
                    } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                    role="switch"
                    aria-checked={settings.show_mobile}
                  >
                    <span
                      className={`${
                        settings.show_mobile ? 'translate-x-5' : 'translate-x-0'
                      } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className={`${
                saving
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
              } inline-flex justify-center rounded-md border border-transparent py-2 px-4 text-sm font-medium text-theme-text-primary shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* Membership ID Settings */}
        <div className="mt-6 bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-theme-text-primary mb-4">
            Membership ID Numbers
          </h3>
          <p className="text-sm text-theme-text-muted mb-6">
            Configure automatic membership ID assignment for new members. When enabled,
            each member who joins the department will receive a sequential membership number.
            The membership coordinator can also manually assign a number to former members
            being reinstated.
          </p>

          <div className="space-y-4">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between py-4 border-b border-theme-surface-border">
              <div>
                <label className="text-sm font-medium text-theme-text-primary">
                  Auto-Assign Membership Numbers
                </label>
                <p className="text-sm text-theme-text-muted">
                  Automatically assign the next sequential membership number when a new member joins
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setMembershipIdSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
                }
                className={`${
                  membershipIdSettings.enabled ? 'bg-blue-600' : 'bg-slate-600'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                role="switch"
                aria-checked={membershipIdSettings.enabled}
              >
                <span
                  className={`${
                    membershipIdSettings.enabled ? 'translate-x-5' : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>

            {membershipIdSettings.enabled && (
              <div className="pl-4 space-y-5">
                {/* Prefix */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-1">
                    Prefix (optional)
                  </label>
                  <p className="text-xs text-theme-text-muted mb-2">
                    Text prepended to each membership number (e.g. &quot;M-&quot;, &quot;FD-&quot;)
                  </p>
                  <input
                    type="text"
                    maxLength={10}
                    value={membershipIdSettings.prefix}
                    onChange={(e) =>
                      setMembershipIdSettings((prev) => ({ ...prev, prefix: e.target.value }))
                    }
                    placeholder="e.g. M-"
                    className="w-32 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Next Number */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-1">
                    Next Number
                  </label>
                  <p className="text-xs text-theme-text-muted mb-2">
                    The next sequential number to assign to a new member
                  </p>
                  <input
                    type="number"
                    min={1}
                    value={membershipIdSettings.next_number}
                    onChange={(e) =>
                      setMembershipIdSettings((prev) => ({
                        ...prev,
                        next_number: Math.max(1, parseInt(e.target.value) || 1),
                      }))
                    }
                    className="w-32 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Zero Padding */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-1">
                    Zero Padding
                  </label>
                  <p className="text-xs text-theme-text-muted mb-2">
                    Pad the number with leading zeros to this many digits (e.g. 3 = &quot;001&quot;)
                  </p>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={membershipIdSettings.zero_pad}
                    onChange={(e) =>
                      setMembershipIdSettings((prev) => ({
                        ...prev,
                        zero_pad: Math.min(10, Math.max(0, parseInt(e.target.value) || 0)),
                      }))
                    }
                    className="w-32 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Preview */}
                <div className="pt-2 border-t border-theme-surface-border">
                  <p className="text-sm text-theme-text-muted">
                    Next membership number to be assigned:{' '}
                    <span className="font-mono font-semibold text-theme-text-primary">
                      {previewNextNumber()}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSaveMembershipIds}
              disabled={savingMembership}
              className={`${
                savingMembership
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
              } inline-flex justify-center rounded-md border border-transparent py-2 px-4 text-sm font-medium text-theme-text-primary shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
            >
              {savingMembership ? 'Saving...' : 'Save Membership ID Settings'}
            </button>
          </div>
        </div>

        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-700 dark:text-yellow-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">Note</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>
                  These settings require <strong>secretary permissions</strong>. In a production environment,
                  only users with the appropriate role will be able to modify these settings.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
