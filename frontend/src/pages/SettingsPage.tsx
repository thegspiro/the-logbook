/**
 * Settings Page
 *
 * Organization settings including module management,
 * contact information visibility, and membership ID settings.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  GraduationCap,
  Package,
  Calendar,
  Vote,
  FileText,
  BarChart3,
  Bell,
  Smartphone,
  ClipboardList,
  Plug,
  Building2,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService } from '../services/api';
import type { ModuleSettingsData } from '../services/api';
import type { ContactInfoSettings, MembershipIdSettings } from '../types/user';

interface ConfigurableModule {
  key: keyof ModuleSettingsData;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const CONFIGURABLE_MODULES: ConfigurableModule[] = [
  { key: 'training', name: 'Training & Certification', description: 'Course management, certification tracking, and compliance monitoring', icon: <GraduationCap className="w-5 h-5" /> },
  { key: 'inventory', name: 'Inventory Management', description: 'Equipment tracking, supply levels, and procurement', icon: <Package className="w-5 h-5" /> },
  { key: 'scheduling', name: 'Scheduling', description: 'Duty rosters, shift scheduling, and calendar management', icon: <Calendar className="w-5 h-5" /> },
  { key: 'elections', name: 'Elections & Voting', description: 'Ballot creation, voting management, and election results', icon: <Vote className="w-5 h-5" /> },
  { key: 'minutes', name: 'Meeting Minutes', description: 'Meeting documentation, attendance tracking, and action items', icon: <FileText className="w-5 h-5" /> },
  { key: 'reports', name: 'Reports & Analytics', description: 'Custom reports, data export, and analytics dashboards', icon: <BarChart3 className="w-5 h-5" /> },
  { key: 'notifications', name: 'Email Notifications', description: 'Automated email alerts and notification rules', icon: <Bell className="w-5 h-5" /> },
  { key: 'mobile', name: 'Mobile App Access', description: 'Mobile-optimized access and push notifications', icon: <Smartphone className="w-5 h-5" /> },
  { key: 'forms', name: 'Custom Forms', description: 'Form builder for inspections, surveys, and data collection', icon: <ClipboardList className="w-5 h-5" /> },
  { key: 'integrations', name: 'External Integrations', description: 'Third-party service connections and API access', icon: <Plug className="w-5 h-5" /> },
  { key: 'facilities', name: 'Facilities Management', description: 'Building management, maintenance scheduling, and inspections', icon: <Building2 className="w-5 h-5" /> },
];

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
  const [moduleSettings, setModuleSettings] = useState<ModuleSettingsData | null>(null);
  const [togglingModule, setTogglingModule] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingMembershipId, setSavingMembershipId] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => { clearTimeout(successTimerRef.current); };
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        setError(null);

        const [settingsData, modulesData] = await Promise.all([
          organizationService.getSettings(),
          organizationService.getEnabledModules(),
        ]);

        setSettings(settingsData.contact_info_visibility);
        if (settingsData.membership_id) {
          setMembershipId(settingsData.membership_id);
        }
        setModuleSettings(modulesData.module_settings);
      } catch (_err) {
        setError('Unable to load settings. Please check your connection and refresh the page.');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleModuleToggle = async (moduleKey: keyof ModuleSettingsData) => {
    if (!moduleSettings || togglingModule) return;

    const newValue = !moduleSettings[moduleKey];
    setTogglingModule(moduleKey);

    try {
      const result = await organizationService.updateModuleSettings({ [moduleKey]: newValue });
      setModuleSettings(result.module_settings);
      const moduleName = CONFIGURABLE_MODULES.find(m => m.key === moduleKey)?.name || moduleKey;
      toast.success(`${moduleName} ${newValue ? 'enabled' : 'disabled'}`);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        toast.error('You do not have permission to change module settings.');
      } else {
        toast.error('Failed to update module settings.');
      }
    } finally {
      setTogglingModule(null);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      await organizationService.updateContactInfoSettings(settings);

      setSuccessMessage('Settings saved successfully!');
      clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 3000);
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
      clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 3000);
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
            <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
          </div>
        </div>
      </div>
    );
  }

  const enabledCount = moduleSettings
    ? CONFIGURABLE_MODULES.filter(m => moduleSettings[m.key]).length
    : 0;

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-theme-text-primary">Organization Settings</h2>
          <p className="mt-1 text-sm text-theme-text-muted">
            Manage modules, contact information visibility, and membership ID settings.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{successMessage}</p>
          </div>
        )}

        {/* Module Management */}
        {moduleSettings && (
          <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-medium text-theme-text-primary">
                  Modules
                </h3>
                <p className="text-sm text-theme-text-muted">
                  Enable or disable optional modules for your organization.
                  Core modules (Members, Events, Documents) are always active.
                </p>
              </div>
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                {enabledCount} / {CONFIGURABLE_MODULES.length} enabled
              </span>
            </div>

            <div className="space-y-1">
              {CONFIGURABLE_MODULES.map((mod) => {
                const isEnabled = moduleSettings[mod.key];
                const isToggling = togglingModule === mod.key;

                return (
                  <div
                    key={mod.key}
                    className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-theme-surface-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                        isEnabled ? 'bg-red-500/10 text-red-500' : 'bg-theme-surface-secondary text-theme-text-muted'
                      }`}>
                        {mod.icon}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${
                          isEnabled ? 'text-theme-text-primary' : 'text-theme-text-muted'
                        }`}>
                          {mod.name}
                        </p>
                        <p className="text-xs text-theme-text-muted truncate">
                          {mod.description}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleModuleToggle(mod.key)}
                      disabled={isToggling}
                      className={`flex-shrink-0 ml-4 ${
                        isEnabled ? 'bg-red-500' : 'bg-slate-600'
                      } relative inline-flex h-6 w-11 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50`}
                      role="switch"
                      aria-checked={isEnabled}
                      aria-label={`Toggle ${mod.name}`}
                    >
                      {isToggling ? (
                        <span className="flex items-center justify-center w-full h-full">
                          <Loader2 className="w-3 h-3 animate-spin text-white" />
                        </span>
                      ) : (
                        <span
                          className={`${
                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                          } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                        />
                      )}
                    </button>
                  </div>
                );
              })}
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
              } inline-flex justify-center rounded-md border border-transparent py-2 px-4 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* Membership ID Number */}
        <div className="mt-6 bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-theme-text-primary mb-4">
            Membership ID Number
          </h3>
          <p className="text-sm text-theme-text-muted mb-6">
            Configure membership ID numbers for your organization. When enabled,
            each member can be assigned a unique ID number displayed on their profile.
          </p>

          <div className="space-y-4">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between py-4 border-b border-theme-surface-border">
              <div>
                <label className="text-sm font-medium text-theme-text-primary">
                  Enable Membership ID Numbers
                </label>
                <p className="text-sm text-theme-text-muted">
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
                    <label className="text-sm font-medium text-theme-text-primary">
                      Auto-Generate IDs
                    </label>
                    <p className="text-sm text-theme-text-muted">
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
                  <label className="block text-sm font-medium text-theme-text-primary mb-1">
                    ID Prefix
                  </label>
                  <p className="text-sm text-theme-text-muted mb-2">
                    Optional prefix prepended to each ID (e.g. &quot;FD-&quot; produces FD-001)
                  </p>
                  <input
                    type="text"
                    maxLength={10}
                    value={membershipId.prefix}
                    onChange={(e) => setMembershipId((prev) => ({ ...prev, prefix: e.target.value }))}
                    placeholder="e.g. FD-"
                    className="w-40 rounded-md bg-theme-surface border border-theme-surface-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Next Number */}
                {membershipId.auto_generate && (
                  <div className="py-3">
                    <label className="block text-sm font-medium text-theme-text-primary mb-1">
                      Next ID Number
                    </label>
                    <p className="text-sm text-theme-text-muted mb-2">
                      The next number to assign when a new member is added
                    </p>
                    <input
                      type="number"
                      min={1}
                      value={membershipId.next_number}
                      onChange={(e) => setMembershipId((prev) => ({ ...prev, next_number: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="w-40 rounded-md bg-theme-surface border border-theme-surface-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
      </div>
    </div>
  );
};

export default SettingsPage;
