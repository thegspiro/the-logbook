/**
 * Settings Page
 *
 * Organization settings including module management,
 * contact information visibility, and membership ID settings.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  X,
  Check,
  Mail,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService, ranksService } from '../services/api';
import type { ModuleSettingsData, OperationalRankResponse } from '../services/api';
import type { ContactInfoSettings, MembershipIdSettings, EmailGenerationSettings, EmailGenerationFormat } from '../types/user';
import { invalidateRanksCache } from '../hooks/useRanks';

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
  const [emailGeneration, setEmailGeneration] = useState<EmailGenerationSettings>({
    enabled: false,
    domain: '',
    format: 'firstname.lastname' as EmailGenerationFormat,
    use_personal_as_primary: false,
  });
  const [savingEmailGen, setSavingEmailGen] = useState(false);
  const [emailPreview, setEmailPreview] = useState<string>('');
  const [moduleSettings, setModuleSettings] = useState<ModuleSettingsData | null>(null);
  const [togglingModule, setTogglingModule] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingMembershipId, setSavingMembershipId] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Rank management state
  const [ranks, setRanks] = useState<OperationalRankResponse[]>([]);
  const [ranksLoading, setRanksLoading] = useState(false);
  const [editingRank, setEditingRank] = useState<OperationalRankResponse | null>(null);
  const [addingRank, setAddingRank] = useState(false);
  const [rankForm, setRankForm] = useState({ rank_code: '', display_name: '' });
  const [rankSaving, setRankSaving] = useState(false);
  const [deletingRankId, setDeletingRankId] = useState<string | null>(null);

  useEffect(() => {
    return () => { clearTimeout(successTimerRef.current); };
  }, []);

  const fetchRanks = useCallback(async () => {
    try {
      setRanksLoading(true);
      invalidateRanksCache();
      const data = await ranksService.getRanks();
      setRanks(data);
    } catch (_err) {
      // Silently fail — ranks section will show empty state
    } finally {
      setRanksLoading(false);
    }
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        setError(null);

        const [settingsData, modulesData] = await Promise.all([
          organizationService.getSettings(),
          organizationService.getEnabledModules(),
          fetchRanks(),
        ]);

        setSettings(settingsData.contact_info_visibility);
        if (settingsData.membership_id) {
          setMembershipId(settingsData.membership_id);
        }
        if (settingsData.email_generation) {
          setEmailGeneration(settingsData.email_generation);
        }
        setModuleSettings(modulesData.module_settings);
      } catch (_err) {
        setError('Unable to load settings. Please check your connection and refresh the page.');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [fetchRanks]);

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

  // Email generation helpers
  const EMAIL_FORMAT_OPTIONS: { value: EmailGenerationFormat; label: string; example: string }[] = [
    { value: 'firstname.lastname', label: 'First.Last', example: 'john.doe' },
    { value: 'firstinitial.lastname', label: 'Initial.Last', example: 'j.doe' },
    { value: 'firstname.lastinitial', label: 'First.Initial', example: 'john.d' },
    { value: 'firstinitiallastname', label: 'InitialLast', example: 'jdoe' },
    { value: 'firstname', label: 'First Name Only', example: 'john' },
    { value: 'lastname.firstname', label: 'Last.First', example: 'doe.john' },
    { value: 'lastname.firstinitial', label: 'Last.Initial', example: 'doe.j' },
  ];

  const getEmailPreview = useCallback((fmt: EmailGenerationFormat, domain: string) => {
    if (!domain) return '';
    const examples: Record<EmailGenerationFormat, string> = {
      'firstname.lastname': 'john.doe',
      'firstinitial.lastname': 'j.doe',
      'firstname.lastinitial': 'john.d',
      'firstinitiallastname': 'jdoe',
      'firstname': 'john',
      'lastname.firstname': 'doe.john',
      'lastname.firstinitial': 'doe.j',
    };
    return `${examples[fmt] || 'john.doe'}@${domain}`;
  }, []);

  // Update preview whenever format or domain changes
  useEffect(() => {
    setEmailPreview(getEmailPreview(emailGeneration.format, emailGeneration.domain));
  }, [emailGeneration.format, emailGeneration.domain, getEmailPreview]);

  const handleSaveEmailGeneration = async () => {
    try {
      setSavingEmailGen(true);
      setError(null);
      setSuccessMessage(null);

      await organizationService.updateEmailGenerationSettings(emailGeneration);

      setSuccessMessage('Email generation settings saved successfully!');
      clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('You do not have permission to update email generation settings.');
      } else {
        setError('Unable to save email generation settings. Please try again.');
      }
    } finally {
      setSavingEmailGen(false);
    }
  };

  const handleAddRank = async () => {
    if (!rankForm.rank_code.trim() || !rankForm.display_name.trim()) return;
    setRankSaving(true);
    try {
      await ranksService.createRank({
        rank_code: rankForm.rank_code.trim().toLowerCase().replace(/\s+/g, '_'),
        display_name: rankForm.display_name.trim(),
        sort_order: ranks.length,
      });
      setRankForm({ rank_code: '', display_name: '' });
      setAddingRank(false);
      toast.success('Rank added');
      await fetchRanks();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Failed to add rank');
    } finally {
      setRankSaving(false);
    }
  };

  const handleUpdateRank = async () => {
    if (!editingRank || !rankForm.display_name.trim()) return;
    setRankSaving(true);
    try {
      await ranksService.updateRank(editingRank.id, {
        rank_code: rankForm.rank_code.trim().toLowerCase().replace(/\s+/g, '_'),
        display_name: rankForm.display_name.trim(),
      });
      setEditingRank(null);
      setRankForm({ rank_code: '', display_name: '' });
      toast.success('Rank updated');
      await fetchRanks();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || 'Failed to update rank');
    } finally {
      setRankSaving(false);
    }
  };

  const handleDeleteRank = async (rankId: string) => {
    setDeletingRankId(rankId);
    try {
      await ranksService.deleteRank(rankId);
      toast.success('Rank removed');
      await fetchRanks();
    } catch (_err) {
      toast.error('Failed to remove rank');
    } finally {
      setDeletingRankId(null);
    }
  };

  const handleMoveRank = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ranks.length) return;
    const newRanks = [...ranks];
    [newRanks[index], newRanks[swapIndex]] = [newRanks[swapIndex], newRanks[index]];
    const reorderPayload = newRanks.map((r, i) => ({ id: r.id, sort_order: i }));
    setRanks(newRanks);
    try {
      await ranksService.reorderRanks(reorderPayload);
    } catch (_err) {
      toast.error('Failed to reorder ranks');
      await fetchRanks();
    }
  };

  const startEditRank = (rank: OperationalRankResponse) => {
    setEditingRank(rank);
    setAddingRank(false);
    setRankForm({ rank_code: rank.rank_code, display_name: rank.display_name });
  };

  const cancelRankForm = () => {
    setEditingRank(null);
    setAddingRank(false);
    setRankForm({ rank_code: '', display_name: '' });
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

        {/* Email Generation */}
        <div className="mt-6 bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-theme-text-primary mb-4">
            <Mail className="w-5 h-5 inline-block mr-2 -mt-0.5" />
            Department Email Generation
          </h3>
          <p className="text-sm text-theme-text-muted mb-6">
            Configure how department email addresses are automatically generated when
            prospective members are converted to full members.
          </p>

          <div className="space-y-4">
            {/* Use Personal as Primary Toggle */}
            <div className="flex items-center justify-between py-4 border-b border-theme-surface-border">
              <div>
                <label className="text-sm font-medium text-theme-text-primary">
                  Use Personal Email as Primary
                </label>
                <p className="text-sm text-theme-text-muted">
                  Members will use their personal email as their department email
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEmailGeneration((prev) => ({
                  ...prev,
                  use_personal_as_primary: !prev.use_personal_as_primary,
                  // Disable auto-generation when using personal email
                  ...(prev.use_personal_as_primary ? {} : { enabled: false }),
                }))}
                className={`${
                  emailGeneration.use_personal_as_primary ? 'bg-blue-600' : 'bg-slate-600'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                role="switch"
                aria-checked={emailGeneration.use_personal_as_primary}
              >
                <span
                  className={`${
                    emailGeneration.use_personal_as_primary ? 'translate-x-5' : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>

            {!emailGeneration.use_personal_as_primary && (
              <>
                {/* Enable Auto-Generation Toggle */}
                <div className="flex items-center justify-between py-4 border-b border-theme-surface-border">
                  <div>
                    <label className="text-sm font-medium text-theme-text-primary">
                      Enable Auto-Generation
                    </label>
                    <p className="text-sm text-theme-text-muted">
                      Automatically generate department email addresses for new members
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEmailGeneration((prev) => ({ ...prev, enabled: !prev.enabled }))}
                    className={`${
                      emailGeneration.enabled ? 'bg-blue-600' : 'bg-slate-600'
                    } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                    role="switch"
                    aria-checked={emailGeneration.enabled}
                  >
                    <span
                      className={`${
                        emailGeneration.enabled ? 'translate-x-5' : 'translate-x-0'
                      } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {emailGeneration.enabled && (
                  <div className="pl-4 space-y-4">
                    {/* Email Domain */}
                    <div className="py-3">
                      <label className="block text-sm font-medium text-theme-text-primary mb-1">
                        Email Domain
                      </label>
                      <p className="text-sm text-theme-text-muted mb-2">
                        The domain used for generated email addresses
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-theme-text-muted">@</span>
                        <input
                          type="text"
                          value={emailGeneration.domain}
                          onChange={(e) => setEmailGeneration((prev) => ({ ...prev, domain: e.target.value.toLowerCase().trim() }))}
                          placeholder="e.g. department.org"
                          className="w-64 rounded-md bg-theme-surface border border-theme-surface-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>

                    {/* Email Format */}
                    <div className="py-3">
                      <label className="block text-sm font-medium text-theme-text-primary mb-1">
                        Email Format
                      </label>
                      <p className="text-sm text-theme-text-muted mb-2">
                        Choose how the local part of the email is constructed from the member's name
                      </p>
                      <select
                        value={emailGeneration.format}
                        onChange={(e) => setEmailGeneration((prev) => ({ ...prev, format: e.target.value as EmailGenerationFormat }))}
                        className="w-64 rounded-md bg-theme-surface border border-theme-surface-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        {EMAIL_FORMAT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label} ({opt.example})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Preview */}
                    {emailPreview && (
                      <div className="py-3">
                        <label className="block text-sm font-medium text-theme-text-primary mb-1">
                          Preview
                        </label>
                        <p className="text-sm text-theme-text-muted mb-2">
                          Example for a member named &quot;John Doe&quot;
                        </p>
                        <div className="inline-flex items-center gap-2 bg-theme-surface-secondary rounded-lg px-4 py-2">
                          <Mail className="w-4 h-4 text-blue-400" />
                          <span className="text-sm font-mono text-theme-text-primary">{emailPreview}</span>
                        </div>
                      </div>
                    )}

                    {/* Duplicate handling note */}
                    <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <p>
                        If a generated email conflicts with an existing member, a number will
                        be appended automatically (e.g. john.doe2@domain.org). The admin can
                        override the suggested email during conversion.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSaveEmailGeneration}
              disabled={savingEmailGen}
              className={`${
                savingEmailGen
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
              } inline-flex justify-center rounded-md border border-transparent py-2 px-4 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2`}
            >
              {savingEmailGen ? 'Saving...' : 'Save Email Settings'}
            </button>
          </div>
        </div>

        {/* Operational Ranks */}
        <div className="mt-6 bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-medium text-theme-text-primary">
                Operational Ranks
              </h3>
              <p className="text-sm text-theme-text-muted">
                Customize the rank/position choices available to your department.
                Drag to reorder. Higher ranks should appear first.
              </p>
            </div>
            {!addingRank && !editingRank && (
              <button
                type="button"
                onClick={() => { setAddingRank(true); setRankForm({ rank_code: '', display_name: '' }); }}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <Plus className="w-4 h-4" />
                Add Rank
              </button>
            )}
          </div>

          {/* Add / Edit form */}
          {(addingRank || editingRank) && (
            <div className="mb-4 p-4 border border-theme-surface-border rounded-lg bg-theme-surface-secondary/50">
              <p className="text-sm font-medium text-theme-text-primary mb-3">
                {editingRank ? 'Edit Rank' : 'New Rank'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-theme-text-muted mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={rankForm.display_name}
                    onChange={(e) => {
                      const display = e.target.value;
                      setRankForm(prev => ({
                        ...prev,
                        display_name: display,
                        // Auto-generate code from display name when adding
                        ...(!editingRank ? { rank_code: display.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') } : {}),
                      }));
                    }}
                    placeholder="e.g. Captain"
                    className="w-full rounded-md bg-theme-surface border border-theme-surface-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-theme-text-muted mb-1">
                    Code (internal identifier)
                  </label>
                  <input
                    type="text"
                    value={rankForm.rank_code}
                    onChange={(e) => setRankForm(prev => ({ ...prev, rank_code: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') }))}
                    placeholder="e.g. captain"
                    className="w-full rounded-md bg-theme-surface border border-theme-surface-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={cancelRankForm}
                  className="inline-flex items-center gap-1 rounded-md border border-theme-surface-border px-3 py-1.5 text-sm font-medium text-theme-text-muted hover:text-theme-text-primary"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={editingRank ? handleUpdateRank : handleAddRank}
                  disabled={rankSaving || !rankForm.display_name.trim() || !rankForm.rank_code.trim()}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed px-3 py-1.5 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  {rankSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {editingRank ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {/* Rank list */}
          {ranksLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
            </div>
          ) : ranks.length === 0 ? (
            <p className="text-sm text-theme-text-muted text-center py-8">
              No ranks configured. Click &quot;Add Rank&quot; to get started.
            </p>
          ) : (
            <div className="space-y-1">
              {ranks.map((rank, idx) => (
                <div
                  key={rank.id}
                  className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-theme-surface-secondary/50 transition-colors group"
                >
                  <div className="flex flex-col flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMoveRank(idx, 'up')}
                      disabled={idx === 0}
                      className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-20 disabled:cursor-not-allowed p-0.5"
                      aria-label="Move up"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveRank(idx, 'down')}
                      disabled={idx === ranks.length - 1}
                      className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-20 disabled:cursor-not-allowed p-0.5"
                      aria-label="Move down"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <GripVertical className="w-4 h-4 text-theme-text-muted/40 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-theme-text-primary">
                      {rank.display_name}
                    </p>
                    <p className="text-xs text-theme-text-muted">
                      {rank.rank_code}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEditRank(rank)}
                      className="p-1.5 rounded text-theme-text-muted hover:text-blue-500 hover:bg-blue-500/10"
                      aria-label={`Edit ${rank.display_name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRank(rank.id)}
                      disabled={deletingRankId === rank.id}
                      className="p-1.5 rounded text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                      aria-label={`Delete ${rank.display_name}`}
                    >
                      {deletingRankId === rank.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
