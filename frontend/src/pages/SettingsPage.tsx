/**
 * Settings Page
 *
 * Organization settings with a sidebar navigation and content panel.
 * Sections: General, Modules, Members, Ranks.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Building2,
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
  Loader2,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  X,
  Check,
  Globe,
  Phone,
  Mail,
  MapPin,
  Upload,
  Shield,
  Users,
  Hash,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService, ranksService } from '../services/api';
import type { ModuleSettingsData, OperationalRankResponse, OrganizationProfile, RankValidationIssue } from '../services/api';
import type { ContactInfoSettings, MembershipIdSettings } from '../types/user';
import { invalidateRanksCache } from '../hooks/useRanks';

// ── Section definitions ──

type SectionKey = 'general' | 'modules' | 'members' | 'ranks';

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType; description: string }[] = [
  { key: 'general', label: 'General', icon: Building2, description: 'Department name, logo, timezone, and contact info' },
  { key: 'modules', label: 'Modules', icon: Package, description: 'Enable or disable optional features' },
  { key: 'members', label: 'Members', icon: Users, description: 'Contact visibility and membership IDs' },
  { key: 'ranks', label: 'Ranks', icon: Shield, description: 'Operational rank configuration' },
];

// ── Module definitions ──

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

// ── Timezone helper ──

const COMMON_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Indiana/Indianapolis', 'America/Detroit', 'America/Kentucky/Louisville',
];

// ── Toggle component ──

const Toggle: React.FC<{
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string;
  color?: 'red' | 'blue';
}> = ({ checked, onChange, disabled, label, color = 'blue' }) => {
  const bg = checked
    ? color === 'red' ? 'bg-red-500' : 'bg-blue-600'
    : 'bg-slate-600';
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`${bg} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${
        color === 'red' ? 'focus:ring-red-500' : 'focus:ring-blue-500'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span
        className={`${
          checked ? 'translate-x-5' : 'translate-x-0'
        } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
      />
    </button>
  );
};

// ── Main component ──

export const SettingsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionKey>('general');
  const [loading, setLoading] = useState(true);

  // General / profile state
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Module state
  const [moduleSettings, setModuleSettings] = useState<ModuleSettingsData | null>(null);
  const [togglingModule, setTogglingModule] = useState<string | null>(null);

  // Contact info state
  const [contactSettings, setContactSettings] = useState<ContactInfoSettings>({
    enabled: false, show_email: true, show_phone: true, show_mobile: true,
  });
  const [savingContact, setSavingContact] = useState(false);

  // Membership ID state
  const [membershipId, setMembershipId] = useState<MembershipIdSettings>({
    enabled: false, auto_generate: false, prefix: '', next_number: 1,
  });
  const [savingMembershipId, setSavingMembershipId] = useState(false);

  // Rank state
  const [ranks, setRanks] = useState<OperationalRankResponse[]>([]);
  const [ranksLoading, setRanksLoading] = useState(false);
  const [editingRank, setEditingRank] = useState<OperationalRankResponse | null>(null);
  const [addingRank, setAddingRank] = useState(false);
  const [rankForm, setRankForm] = useState({ rank_code: '', display_name: '' });
  const [rankSaving, setRankSaving] = useState(false);
  const [deletingRankId, setDeletingRankId] = useState<string | null>(null);

  // Rank validation state
  const [rankValidationIssues, setRankValidationIssues] = useState<RankValidationIssue[]>([]);

  // ── Data loading ──

  const fetchRankValidation = useCallback(async () => {
    try {
      const result = await ranksService.validateRanks();
      setRankValidationIssues(result.issues);
    } catch {
      // Silently ignore – validation is non-blocking
    }
  }, []);

  const fetchRanks = useCallback(async () => {
    try {
      setRanksLoading(true);
      invalidateRanksCache();
      const data = await ranksService.getRanks();
      setRanks(data);
    } catch { /* empty state shown */ } finally {
      setRanksLoading(false);
    }
    // Re-run validation whenever the rank list changes
    await fetchRankValidation();
  }, [fetchRankValidation]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [settingsData, modulesData, profileData] = await Promise.all([
          organizationService.getSettings(),
          organizationService.getEnabledModules(),
          organizationService.getProfile(),
          fetchRanks(),
        ]);
        setContactSettings(settingsData.contact_info_visibility);
        if (settingsData.membership_id) setMembershipId(settingsData.membership_id);
        setModuleSettings(modulesData.module_settings);
        setProfile(profileData);
      } catch {
        toast.error('Unable to load settings.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchRanks]);

  // ── Profile handlers ──

  const updateProfileField = <K extends keyof OrganizationProfile>(field: K, value: OrganizationProfile[K]) => {
    if (!profile) return;
    setProfile({ ...profile, [field]: value });
    setProfileDirty(true);
  };

  const updateAddressField = (field: string, value: string) => {
    if (!profile) return;
    setProfile({
      ...profile,
      mailing_address: { ...profile.mailing_address, [field]: value },
    });
    setProfileDirty(true);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Logo must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      updateProfileField('logo', reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try {
      const updated = await organizationService.updateProfile(profile);
      setProfile(updated);
      setProfileDirty(false);
      // Sync branding to localStorage (keys match AppLayout)
      localStorage.setItem('departmentName', updated.name);
      if (updated.logo) {
        localStorage.setItem('logoData', updated.logo);
      } else {
        localStorage.removeItem('logoData');
      }
      // Notify AppLayout to re-render with new branding
      window.dispatchEvent(new CustomEvent('branding-updated', {
        detail: { name: updated.name, logo: updated.logo },
      }));
      toast.success('Profile saved');
    } catch {
      toast.error('Failed to save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Module handlers ──

  const handleModuleToggle = async (moduleKey: keyof ModuleSettingsData) => {
    if (!moduleSettings || togglingModule) return;
    const newValue = !moduleSettings[moduleKey];
    setTogglingModule(moduleKey);
    try {
      const result = await organizationService.updateModuleSettings({ [moduleKey]: newValue });
      setModuleSettings(result.module_settings);
      const name = CONFIGURABLE_MODULES.find(m => m.key === moduleKey)?.name || moduleKey;
      toast.success(`${name} ${newValue ? 'enabled' : 'disabled'}`);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(status === 403 ? 'Permission denied.' : 'Failed to update module.');
    } finally {
      setTogglingModule(null);
    }
  };

  // ── Contact info handlers ──

  const handleSaveContact = async () => {
    setSavingContact(true);
    try {
      await organizationService.updateContactInfoSettings(contactSettings);
      toast.success('Contact visibility saved');
    } catch { toast.error('Failed to save'); } finally { setSavingContact(false); }
  };

  // ── Membership ID handlers ──

  const handleSaveMembershipId = async () => {
    setSavingMembershipId(true);
    try {
      await organizationService.updateMembershipIdSettings(membershipId);
      toast.success('Membership ID settings saved');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(status === 403 ? 'Permission denied.' : 'Failed to save.');
    } finally { setSavingMembershipId(false); }
  };

  // ── Rank handlers ──

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
    } finally { setRankSaving(false); }
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
    } finally { setRankSaving(false); }
  };

  const handleDeleteRank = async (rankId: string) => {
    setDeletingRankId(rankId);
    try {
      await ranksService.deleteRank(rankId);
      toast.success('Rank removed');
      await fetchRanks();
    } catch { toast.error('Failed to remove rank'); } finally { setDeletingRankId(null); }
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
    } catch { toast.error('Failed to reorder'); await fetchRanks(); }
  };

  // ── Loading state ──

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  const enabledCount = moduleSettings
    ? CONFIGURABLE_MODULES.filter(m => moduleSettings[m.key]).length
    : 0;

  // ── Render section content ──

  const renderContent = () => {
    switch (activeSection) {
      // ════════════════════════════════════════════
      // GENERAL
      // ════════════════════════════════════════════
      case 'general':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary">Department Profile</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Basic information about your department.
              </p>
            </div>

            {/* Logo */}
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-theme-surface-border flex items-center justify-center overflow-hidden bg-theme-surface-secondary flex-shrink-0">
                {profile?.logo ? (
                  <img src={profile.logo} alt="" className="max-w-full max-h-full object-contain" />
                ) : (
                  <Building2 className="w-8 h-8 text-theme-text-muted" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-theme-text-primary">Department Logo</p>
                <p className="text-xs text-theme-text-muted mb-2">PNG, JPG, or SVG. Max 2 MB.</p>
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-500"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload logo
                </button>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </div>
            </div>

            {/* Name + Timezone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-1">Department Name</label>
                <input
                  type="text"
                  value={profile?.name || ''}
                  onChange={(e) => updateProfileField('name', e.target.value)}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-1">Timezone</label>
                <select
                  value={profile?.timezone || 'America/New_York'}
                  onChange={(e) => updateProfileField('timezone', e.target.value)}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {COMMON_TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Contact */}
            <div>
              <p className="text-sm font-medium text-theme-text-primary mb-3 flex items-center gap-2">
                <Phone className="w-4 h-4 text-theme-text-muted" /> Contact Information
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Phone</label>
                  <input
                    type="text"
                    value={profile?.phone || ''}
                    onChange={(e) => updateProfileField('phone', e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={profile?.email || ''}
                    onChange={(e) => updateProfileField('email', e.target.value)}
                    placeholder="info@firedept.org"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Website</label>
                  <input
                    type="url"
                    value={profile?.website || ''}
                    onChange={(e) => updateProfileField('website', e.target.value)}
                    placeholder="https://firedept.org"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">County</label>
                  <input
                    type="text"
                    value={profile?.county || ''}
                    onChange={(e) => updateProfileField('county', e.target.value)}
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Mailing Address */}
            <div>
              <p className="text-sm font-medium text-theme-text-primary mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-theme-text-muted" /> Mailing Address
              </p>
              <div className="grid grid-cols-1 gap-3">
                <input
                  type="text"
                  value={profile?.mailing_address?.line1 || ''}
                  onChange={(e) => updateAddressField('line1', e.target.value)}
                  placeholder="Address line 1"
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={profile?.mailing_address?.line2 || ''}
                  onChange={(e) => updateAddressField('line2', e.target.value)}
                  placeholder="Address line 2 (optional)"
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="grid grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={profile?.mailing_address?.city || ''}
                    onChange={(e) => updateAddressField('city', e.target.value)}
                    placeholder="City"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={profile?.mailing_address?.state || ''}
                    onChange={(e) => updateAddressField('state', e.target.value)}
                    placeholder="State"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={profile?.mailing_address?.zip || ''}
                    onChange={(e) => updateAddressField('zip', e.target.value)}
                    placeholder="ZIP"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Save */}
            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile || !profileDirty}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </div>
        );

      // ════════════════════════════════════════════
      // MODULES
      // ════════════════════════════════════════════
      case 'modules':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-theme-text-primary">Modules</h3>
                <p className="text-sm text-theme-text-muted mt-1">
                  Enable or disable optional modules. Core modules (Members, Events, Documents) are always active.
                </p>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                {enabledCount} / {CONFIGURABLE_MODULES.length}
              </span>
            </div>

            <div className="space-y-1">
              {CONFIGURABLE_MODULES.map((mod) => {
                const isEnabled = moduleSettings?.[mod.key] ?? false;
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
                        <p className={`text-sm font-medium ${isEnabled ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                          {mod.name}
                        </p>
                        <p className="text-xs text-theme-text-muted truncate">{mod.description}</p>
                      </div>
                    </div>
                    <div className="flex-shrink-0 ml-4">
                      {isToggling ? (
                        <div className="w-11 h-6 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
                        </div>
                      ) : (
                        <Toggle
                          checked={isEnabled}
                          onChange={() => handleModuleToggle(mod.key)}
                          color="red"
                          label={`Toggle ${mod.name}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      // ════════════════════════════════════════════
      // MEMBERS
      // ════════════════════════════════════════════
      case 'members':
        return (
          <div className="space-y-8">
            {/* Contact Info Visibility */}
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
                <Mail className="w-5 h-5 text-theme-text-muted" />
                Contact Information Visibility
              </h3>
              <p className="text-sm text-theme-text-muted mt-1 mb-4">
                Control whether contact information is displayed on the member list page.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between py-3 border-b border-theme-surface-border">
                  <div>
                    <p className="text-sm font-medium text-theme-text-primary">Show Contact Information</p>
                    <p className="text-xs text-theme-text-muted">Enable display of contact info for all members</p>
                  </div>
                  <Toggle checked={contactSettings.enabled} onChange={() => setContactSettings(s => ({ ...s, enabled: !s.enabled }))} />
                </div>

                {contactSettings.enabled && (
                  <div className="pl-4 space-y-3">
                    <div className="flex items-center justify-between py-2">
                      <p className="text-sm text-theme-text-primary">Show Email Addresses</p>
                      <Toggle checked={contactSettings.show_email} onChange={() => setContactSettings(s => ({ ...s, show_email: !s.show_email }))} />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <p className="text-sm text-theme-text-primary">Show Phone Numbers</p>
                      <Toggle checked={contactSettings.show_phone} onChange={() => setContactSettings(s => ({ ...s, show_phone: !s.show_phone }))} />
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <p className="text-sm text-theme-text-primary">Show Mobile Numbers</p>
                      <Toggle checked={contactSettings.show_mobile} onChange={() => setContactSettings(s => ({ ...s, show_mobile: !s.show_mobile }))} />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end mt-4">
                <button
                  onClick={handleSaveContact}
                  disabled={savingContact}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  {savingContact && <Loader2 className="w-4 h-4 animate-spin" />}
                  {savingContact ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            <div className="border-t border-theme-surface-border" />

            {/* Membership ID */}
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
                <Hash className="w-5 h-5 text-theme-text-muted" />
                Membership ID Number
              </h3>
              <p className="text-sm text-theme-text-muted mt-1 mb-4">
                Configure membership ID numbers. Each member can be assigned a unique ID displayed on their profile.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between py-3 border-b border-theme-surface-border">
                  <div>
                    <p className="text-sm font-medium text-theme-text-primary">Enable Membership ID Numbers</p>
                    <p className="text-xs text-theme-text-muted">Display membership IDs on member profiles and lists</p>
                  </div>
                  <Toggle checked={membershipId.enabled} onChange={() => setMembershipId(s => ({ ...s, enabled: !s.enabled }))} />
                </div>

                {membershipId.enabled && (
                  <div className="pl-4 space-y-4">
                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm text-theme-text-primary">Auto-Generate IDs</p>
                        <p className="text-xs text-theme-text-muted">Automatically assign sequential IDs to new members</p>
                      </div>
                      <Toggle checked={membershipId.auto_generate} onChange={() => setMembershipId(s => ({ ...s, auto_generate: !s.auto_generate }))} />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-theme-text-primary mb-1">ID Prefix</label>
                      <p className="text-xs text-theme-text-muted mb-2">Optional prefix (e.g. &quot;FD-&quot; produces FD-001)</p>
                      <input
                        type="text"
                        maxLength={10}
                        value={membershipId.prefix}
                        onChange={(e) => setMembershipId(s => ({ ...s, prefix: e.target.value }))}
                        placeholder="e.g. FD-"
                        className="w-40 rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {membershipId.auto_generate && (
                      <div>
                        <label className="block text-sm font-medium text-theme-text-primary mb-1">Next ID Number</label>
                        <p className="text-xs text-theme-text-muted mb-2">Next number assigned when a new member is added</p>
                        <input
                          type="number"
                          min={1}
                          value={membershipId.next_number}
                          onChange={(e) => setMembershipId(s => ({ ...s, next_number: Math.max(1, parseInt(e.target.value) || 1) }))}
                          className="w-40 rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end mt-4">
                <button
                  onClick={handleSaveMembershipId}
                  disabled={savingMembershipId}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  {savingMembershipId && <Loader2 className="w-4 h-4 animate-spin" />}
                  {savingMembershipId ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        );

      // ════════════════════════════════════════════
      // RANKS
      // ════════════════════════════════════════════
      case 'ranks':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-theme-text-primary">Operational Ranks</h3>
                <p className="text-sm text-theme-text-muted mt-1">
                  Customize rank/position choices for your department. Higher ranks should appear first.
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
              <div className="p-4 border border-theme-surface-border rounded-lg bg-theme-surface-secondary/50">
                <p className="text-sm font-medium text-theme-text-primary mb-3">
                  {editingRank ? 'Edit Rank' : 'New Rank'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-theme-text-muted mb-1">Display Name</label>
                    <input
                      type="text"
                      value={rankForm.display_name}
                      onChange={(e) => {
                        const display = e.target.value;
                        setRankForm(prev => ({
                          ...prev,
                          display_name: display,
                          ...(!editingRank ? { rank_code: display.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') } : {}),
                        }));
                      }}
                      placeholder="e.g. Captain"
                      className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-theme-text-muted mb-1">Code (internal identifier)</label>
                    <input
                      type="text"
                      value={rankForm.rank_code}
                      onChange={(e) => setRankForm(prev => ({ ...prev, rank_code: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') }))}
                      placeholder="e.g. captain"
                      className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => { setEditingRank(null); setAddingRank(false); setRankForm({ rank_code: '', display_name: '' }); }}
                    className="inline-flex items-center gap-1 rounded-md border border-theme-surface-border px-3 py-1.5 text-sm font-medium text-theme-text-muted hover:text-theme-text-primary"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
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
                      <button type="button" onClick={() => handleMoveRank(idx, 'up')} disabled={idx === 0} className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-20 disabled:cursor-not-allowed p-0.5" aria-label="Move up">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => handleMoveRank(idx, 'down')} disabled={idx === ranks.length - 1} className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-20 disabled:cursor-not-allowed p-0.5" aria-label="Move down">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <GripVertical className="w-4 h-4 text-theme-text-muted/40 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-theme-text-primary">{rank.display_name}</p>
                      <p className="text-xs text-theme-text-muted">{rank.rank_code}</p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => { setEditingRank(rank); setAddingRank(false); setRankForm({ rank_code: rank.rank_code, display_name: rank.display_name }); }}
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
                        {deletingRankId === rank.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Rank validation issues */}
            {rankValidationIssues.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                      {rankValidationIssues.length} active member{rankValidationIssues.length !== 1 ? 's' : ''} with unrecognised rank{rankValidationIssues.length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-theme-text-muted mt-1">
                      The following members have a rank assigned that no longer matches any configured rank.
                      Update their profile or re-add the missing rank to resolve.
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {rankValidationIssues.map((issue) => (
                        <li key={issue.member_id} className="flex items-center gap-2 text-sm">
                          <span className="text-theme-text-primary font-medium">{issue.member_name}</span>
                          <span className="text-xs text-theme-text-muted">&mdash;</span>
                          <code className="text-xs bg-theme-surface-secondary px-1.5 py-0.5 rounded text-amber-600 dark:text-amber-400">
                            {issue.rank_code}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
    }
  };

  // ── Main layout: sidebar + content ──

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-theme-text-primary">Organization Settings</h2>
          <p className="mt-1 text-sm text-theme-text-muted">
            Manage your department profile, modules, and configuration.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar */}
          <nav className="md:w-56 flex-shrink-0" aria-label="Settings sections">
            <div className="md:sticky md:top-24 space-y-1">
              {SECTIONS.map(({ key, label, icon: Icon, description }) => {
                const isActive = activeSection === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveSection(key)}
                    className={`w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isActive
                        ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                        : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{label}</p>
                      <p className={`text-xs ${isActive ? 'text-blue-600/70 dark:text-blue-400/70' : 'text-theme-text-muted'} hidden md:block`}>
                        {description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Content panel */}
          <main className="flex-1 min-w-0">
            <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
