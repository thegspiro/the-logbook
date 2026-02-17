/**
 * Settings Page
 *
 * Allows secretary to manage contact information visibility
 * and membership ID settings.
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
  const [membershipId, setMembershipId] = useState<MembershipIdSettings>({
    enabled: false,
    auto_generate: false,
    prefix: '',
    next_number: 1,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingMembershipId, setSavingMembershipId] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        setError(null);

        const data = await organizationService.getSettings();
        setSettings(data.contact_info_visibility);
        if (data.membership_id) {
          setMembershipId(data.membership_id);
        }
      } catch (_err) {
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
    } catch (_err) {
      setError('Unable to save settings. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMembershipId = async () => {
    try {
      setSavingMembershipId(true);
      setError(null);
      setSuccessMessage(null);

      await organizationService.updateMembershipIdSettings(membershipId);

      setSuccessMessage('Membership ID settings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('You do not have permission to update membership ID settings.');
      } else {
        setError('Unable to save membership ID settings. Please try again.');
      }
    } finally {
      setSavingMembershipId(false);
    }
  };

  const handleToggle = (field: keyof ContactInfoSettings) => {
    setSettings((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleMembershipIdToggle = (field: 'enabled' | 'auto_generate') => {
    setMembershipId((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="text-slate-400">Loading settings...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white">Organization Settings</h2>
          <p className="mt-1 text-sm text-slate-400">
            Manage contact information visibility and membership ID settings.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
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
                  className="h-5 w-5 text-green-400"
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
        <div className="bg-white/10 backdrop-blur-sm shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">
            Contact Information Visibility
          </h3>
          <p className="text-sm text-slate-400 mb-6">
            Control whether contact information is displayed on the member list page.
            When enabled, a privacy notice will be shown to remind users that this information
            is for department purposes only.
          </p>

          <div className="space-y-4">
            {/* Master Toggle */}
            <div className="flex items-center justify-between py-4 border-b border-white/20">
              <div>
                <label htmlFor="enabled" className="text-sm font-medium text-white">
                  Show Contact Information
                </label>
                <p className="text-sm text-slate-400">
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
                    <label htmlFor="show_email" className="text-sm font-medium text-white">
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
                    <label htmlFor="show_phone" className="text-sm font-medium text-white">
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
                    <label htmlFor="show_mobile" className="text-sm font-medium text-white">
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
              } inline-flex justify-center rounded-md border border-transparent py-2 px-4 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* Membership ID Number */}
        <div className="mt-6 bg-white/10 backdrop-blur-sm shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-white mb-4">
            Membership ID Number
          </h3>
          <p className="text-sm text-slate-400 mb-6">
            Configure membership ID numbers for your organization. When enabled,
            each member can be assigned a unique ID number displayed on their profile.
          </p>

          <div className="space-y-4">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between py-4 border-b border-white/20">
              <div>
                <label className="text-sm font-medium text-white">
                  Enable Membership ID Numbers
                </label>
                <p className="text-sm text-slate-400">
                  Display membership ID numbers on member profiles and lists
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleMembershipIdToggle('enabled')}
                className={`${
                  membershipId.enabled ? 'bg-blue-600' : 'bg-slate-600'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                role="switch"
                aria-checked={membershipId.enabled}
              >
                <span
                  className={`${
                    membershipId.enabled ? 'translate-x-5' : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>

            {membershipId.enabled && (
              <div className="pl-4 space-y-4">
                {/* Auto-Generate Toggle */}
                <div className="flex items-center justify-between py-3">
                  <div>
                    <label className="text-sm font-medium text-white">
                      Auto-Generate IDs
                    </label>
                    <p className="text-sm text-slate-400">
                      Automatically assign the next sequential ID to new members
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleMembershipIdToggle('auto_generate')}
                    className={`${
                      membershipId.auto_generate ? 'bg-blue-600' : 'bg-slate-600'
                    } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                    role="switch"
                    aria-checked={membershipId.auto_generate}
                  >
                    <span
                      className={`${
                        membershipId.auto_generate ? 'translate-x-5' : 'translate-x-0'
                      } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* Prefix */}
                <div className="py-3">
                  <label className="block text-sm font-medium text-white mb-1">
                    ID Prefix
                  </label>
                  <p className="text-sm text-slate-400 mb-2">
                    Optional prefix prepended to each ID (e.g. &quot;FD-&quot; produces FD-001)
                  </p>
                  <input
                    type="text"
                    maxLength={10}
                    value={membershipId.prefix}
                    onChange={(e) => setMembershipId((prev) => ({ ...prev, prefix: e.target.value }))}
                    placeholder="e.g. FD-"
                    className="w-40 rounded-md bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Next Number */}
                {membershipId.auto_generate && (
                  <div className="py-3">
                    <label className="block text-sm font-medium text-white mb-1">
                      Next ID Number
                    </label>
                    <p className="text-sm text-slate-400 mb-2">
                      The next number to assign when a new member is added
                    </p>
                    <input
                      type="number"
                      min={1}
                      value={membershipId.next_number}
                      onChange={(e) => setMembershipId((prev) => ({ ...prev, next_number: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="w-40 rounded-md bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSaveMembershipId}
              disabled={savingMembershipId}
              className={`${
                savingMembershipId
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
              } inline-flex justify-center rounded-md border border-transparent py-2 px-4 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
            >
              {savingMembershipId ? 'Saving...' : 'Save Membership ID Settings'}
            </button>
          </div>
        </div>

        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-400"
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
                  This setting requires <strong>secretary permissions</strong>. In a production environment,
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
