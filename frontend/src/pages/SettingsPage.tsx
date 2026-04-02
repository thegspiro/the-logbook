/**
 * Settings Page
 *
 * Organization settings with a sidebar navigation and content panel.
 * Sections: General, Modules, Members, Ranks, Email, Storage, Authentication.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  X,
  Check,
  Phone,
  Mail,
  MapPin,
  Upload,
  Shield,
  Users,
  Hash,
  Truck,
  MessageSquare,
  Briefcase,
  DollarSign,
  UserPlus,
  Globe,
  HardDrive,
  Key,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { HelpLink } from '../components/HelpLink';
import { organizationService, ranksService } from '../services/api';
import type { ModuleSettingsData, OperationalRankResponse, OrganizationProfile, RankValidationIssue } from '../services/api';
import type { ContactInfoSettings, MembershipIdSettings, EmailServiceSettings, FileStorageSettings, AuthSettings } from '../types/user';
import { invalidateRanksCache } from '../hooks/useRanks';
import EmailSettingsSection from '../components/settings/EmailSettingsSection';
import StorageSettingsSection from '../components/settings/StorageSettingsSection';
import AuthSettingsSection from '../components/settings/AuthSettingsSection';
import RanksSettingsSection from '../components/settings/RanksSettingsSection';

// ── Section definitions ──

type SectionKey = 'general' | 'modules' | 'members' | 'ranks' | 'email' | 'storage' | 'authentication';

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType; description: string }[] = [
  { key: 'general', label: 'General', icon: Building2, description: 'Department name, logo, timezone, and contact info' },
  { key: 'modules', label: 'Modules', icon: Package, description: 'Enable or disable optional features' },
  { key: 'members', label: 'Members', icon: Users, description: 'Contact visibility and membership IDs' },
  { key: 'ranks', label: 'Ranks', icon: Shield, description: 'Operational rank configuration' },
  { key: 'email', label: 'Email', icon: Mail, description: 'Email platform and notification settings' },
  { key: 'storage', label: 'Storage', icon: HardDrive, description: 'File storage platform configuration' },
  { key: 'authentication', label: 'Authentication', icon: Key, description: 'User sign-in and SSO provider' },
];

// ── Module definitions ──

interface ConfigurableModule {
  key: keyof ModuleSettingsData;
  name: string;
  description: string;
  icon: React.ReactNode;
}

/** Standard modules — enabled by default for all organizations */
const STANDARD_MODULES: ConfigurableModule[] = [
  { key: 'training', name: 'Training & Certification', description: 'Course management, certification tracking, and compliance monitoring', icon: <GraduationCap className="w-5 h-5" /> },
  { key: 'inventory', name: 'Inventory Management', description: 'Equipment tracking, supply levels, and procurement', icon: <Package className="w-5 h-5" /> },
  { key: 'scheduling', name: 'Scheduling', description: 'Duty rosters, shift scheduling, and calendar management', icon: <Calendar className="w-5 h-5" /> },
  { key: 'apparatus', name: 'Apparatus Management', description: 'Vehicle tracking, maintenance schedules, and equipment inventory', icon: <Truck className="w-5 h-5" /> },
  { key: 'minutes', name: 'Meeting Minutes', description: 'Meeting documentation, attendance tracking, and action items', icon: <FileText className="w-5 h-5" /> },
  { key: 'reports', name: 'Reports & Analytics', description: 'Custom reports, data export, and analytics dashboards', icon: <BarChart3 className="w-5 h-5" /> },
  { key: 'notifications', name: 'Email Notifications', description: 'Automated email alerts and notification rules', icon: <Bell className="w-5 h-5" /> },
  { key: 'forms', name: 'Custom Forms', description: 'Form builder for inspections, surveys, and data collection', icon: <ClipboardList className="w-5 h-5" /> },
  { key: 'integrations', name: 'External Integrations', description: 'Third-party service connections and API access', icon: <Plug className="w-5 h-5" /> },
  { key: 'facilities', name: 'Facilities Management', description: 'Building management, maintenance scheduling, and inspections', icon: <Building2 className="w-5 h-5" /> },
  { key: 'prospective_members', name: 'Prospective Members', description: 'Applicant-to-member pipeline with configurable stages', icon: <UserPlus className="w-5 h-5" /> },
  { key: 'public_info', name: 'Public Information', description: 'Public-facing pages, community outreach, and fire safety education', icon: <Globe className="w-5 h-5" /> },
];

/** Additional modules — disabled by default, opt-in */
const ADDITIONAL_MODULES: ConfigurableModule[] = [
  { key: 'communications', name: 'Communications', description: 'Internal messaging, announcements, and notifications', icon: <MessageSquare className="w-5 h-5" /> },
  { key: 'elections', name: 'Elections & Voting', description: 'Ballot creation, voting management, and election results', icon: <Vote className="w-5 h-5" /> },
  { key: 'mobile', name: 'Mobile App Access', description: 'Mobile-optimized access with pull-to-refresh and responsive UI', icon: <Smartphone className="w-5 h-5" /> },
  { key: 'incidents', name: 'Incidents & Reports', description: 'Incident logging, run reports, and analytics', icon: <FileText className="w-5 h-5" /> },
  { key: 'hr_payroll', name: 'HR & Payroll', description: 'Time tracking, compensation, and benefits management', icon: <Briefcase className="w-5 h-5" /> },
  { key: 'grants', name: 'Grants & Fundraising', description: 'Grant tracking, fundraising campaigns, and budget management', icon: <DollarSign className="w-5 h-5" /> },
];

const CONFIGURABLE_MODULES: ConfigurableModule[] = [...STANDARD_MODULES, ...ADDITIONAL_MODULES];

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
    ? color === 'red' ? 'bg-theme-accent-red' : 'bg-theme-accent-blue'
    : 'bg-theme-surface-hover';
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`${bg} relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-offset-2 ${
        color === 'red' ? 'focus:ring-theme-focus-ring' : 'focus:ring-theme-focus-ring'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span
        className={`${
          checked ? 'translate-x-5' : 'translate-x-0'
        } toggle-knob-md`}
      />
    </button>
  );
};

// ── Main component ──

const SECTION_KEYS = new Set<string>(SECTIONS.map(s => s.key));

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [activeSection, setActiveSection] = useState<SectionKey>(
    initialTab && SECTION_KEYS.has(initialTab) ? (initialTab as SectionKey) : 'general',
  );
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

  // Email settings state
  const [emailSettings, setEmailSettings] = useState<EmailServiceSettings>({
    enabled: false, platform: 'other', smtp_port: 587, smtp_encryption: 'tls', use_tls: true,
  });
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailPasswordVisible, setEmailPasswordVisible] = useState(false);

  // File storage state
  const [storageSettings, setStorageSettings] = useState<FileStorageSettings>({ platform: 'local' });
  const [savingStorage, setSavingStorage] = useState(false);
  const [storageSecretVisible, setStorageSecretVisible] = useState(false);

  // Authentication state
  const [authSettings, setAuthSettings] = useState<AuthSettings>({ provider: 'local' });
  const [savingAuth, setSavingAuth] = useState(false);
  const [authSecretVisible, setAuthSecretVisible] = useState(false);

  // Rank state
  const [ranks, setRanks] = useState<OperationalRankResponse[]>([]);
  const [ranksLoading, setRanksLoading] = useState(false);
  const [editingRank, setEditingRank] = useState<OperationalRankResponse | null>(null);
  const [addingRank, setAddingRank] = useState(false);
  const [rankForm, setRankForm] = useState({ rank_code: '', display_name: '' });
  const [rankSaving, setRankSaving] = useState(false);
  const [deletingRankId, setDeletingRankId] = useState<string | null>(null);
  const [editingPositionsRankId, setEditingPositionsRankId] = useState<string | null>(null);

  // Rank validation state
  const [rankValidationIssues, setRankValidationIssues] = useState<RankValidationIssue[]>([]);

  const switchSection = useCallback((key: SectionKey) => {
    setActiveSection(key);
    setSearchParams(key === 'general' ? {} : { tab: key }, { replace: true });
  }, [setSearchParams]);

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
        if (settingsData.email_service) setEmailSettings(settingsData.email_service);
        if (settingsData.file_storage) setStorageSettings(settingsData.file_storage);
        if (settingsData.auth) setAuthSettings(settingsData.auth);
        setModuleSettings(modulesData.module_settings);
        setProfile(profileData);
      } catch {
        toast.error('Unable to load settings.');
      } finally {
        setLoading(false);
      }
    };
    void load();
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

  const updatePhysicalAddressField = (field: string, value: string) => {
    if (!profile) return;
    setProfile({
      ...profile,
      physical_address: { ...profile.physical_address, [field]: value },
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

  // ── Email settings handlers ──

  const handleSaveEmail = async () => {
    setSavingEmail(true);
    try {
      const updated = await organizationService.updateEmailSettings(emailSettings);
      setEmailSettings(updated);
      toast.success('Email settings saved');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(status === 403 ? 'Permission denied.' : 'Failed to save email settings.');
    } finally { setSavingEmail(false); }
  };

  // ── File storage handlers ──

  const handleSaveStorage = async () => {
    setSavingStorage(true);
    try {
      const updated = await organizationService.updateFileStorageSettings(storageSettings);
      setStorageSettings(updated);
      toast.success('File storage settings saved');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(status === 403 ? 'Permission denied.' : 'Failed to save storage settings.');
    } finally { setSavingStorage(false); }
  };

  // ── Authentication handlers ──

  const handleSaveAuth = async () => {
    setSavingAuth(true);
    try {
      const updated = await organizationService.updateAuthSettings(authSettings);
      setAuthSettings(updated);
      toast.success('Authentication settings saved');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(status === 403 ? 'Permission denied.' : 'Failed to save authentication settings.');
    } finally { setSavingAuth(false); }
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
    const a = newRanks[index];
    const b = newRanks[swapIndex];
    if (a === undefined || b === undefined) return;
    [newRanks[index], newRanks[swapIndex]] = [b, a];
    const reorderPayload = newRanks.map((r, i) => ({ id: r.id, sort_order: i }));
    setRanks(newRanks);
    try {
      await ranksService.reorderRanks(reorderPayload);
    } catch { toast.error('Failed to reorder'); await fetchRanks(); }
  };

  const handleToggleEligiblePosition = async (rank: OperationalRankResponse, position: string) => {
    const current = rank.eligible_positions ?? [];
    const updated = current.includes(position)
      ? current.filter((p) => p !== position)
      : [...current, position];
    try {
      await ranksService.updateRank(rank.id, { eligible_positions: updated });
      setRanks((prev) =>
        prev.map((r) => (r.id === rank.id ? { ...r, eligible_positions: updated } : r)),
      );
    } catch {
      toast.error('Failed to update eligible positions');
    }
  };

  // ── Loading state ──

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
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
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-theme-surface-border flex items-center justify-center overflow-hidden bg-theme-surface-secondary shrink-0">
                {profile?.logo ? (
                  <img src={profile.logo} alt={`${profile.name || 'Department'} logo`} className="max-w-full max-h-full object-contain" />
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
                  className="inline-flex items-center gap-1.5 text-sm text-theme-accent-blue hover:opacity-80"
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
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-1">Timezone</label>
                <select
                  value={profile?.timezone || 'America/New_York'}
                  onChange={(e) => updateProfileField('timezone', e.target.value)}
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
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
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={profile?.email || ''}
                    onChange={(e) => updateProfileField('email', e.target.value)}
                    placeholder="info@firedept.org"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">Website</label>
                  <input
                    type="url"
                    value={profile?.website || ''}
                    onChange={(e) => updateProfileField('website', e.target.value)}
                    placeholder="https://firedept.org"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs text-theme-text-muted mb-1">County</label>
                  <input
                    type="text"
                    value={profile?.county || ''}
                    onChange={(e) => updateProfileField('county', e.target.value)}
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
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
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <input
                  type="text"
                  value={profile?.mailing_address?.line2 || ''}
                  onChange={(e) => updateAddressField('line2', e.target.value)}
                  placeholder="Address line 2 (optional)"
                  className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <div className="grid grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={profile?.mailing_address?.city || ''}
                    onChange={(e) => updateAddressField('city', e.target.value)}
                    placeholder="City"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                  <input
                    type="text"
                    value={profile?.mailing_address?.state || ''}
                    onChange={(e) => updateAddressField('state', e.target.value)}
                    placeholder="State"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                  <input
                    type="text"
                    value={profile?.mailing_address?.zip || ''}
                    onChange={(e) => updateAddressField('zip', e.target.value)}
                    placeholder="ZIP"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                </div>
              </div>
            </div>

            {/* Physical Address */}
            <div>
              <p className="text-sm font-medium text-theme-text-primary mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-theme-text-muted" /> Physical Address
              </p>
              <label className="flex items-center gap-2 mb-3 text-sm text-theme-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile?.physical_address_same ?? true}
                  onChange={(e) => updateProfileField('physical_address_same', e.target.checked)}
                  className="rounded border-theme-input-border text-red-600 focus:ring-red-500"
                />
                Same as mailing address
              </label>
              {!profile?.physical_address_same && (
                <div className="grid grid-cols-1 gap-3">
                  <input
                    type="text"
                    value={profile?.physical_address?.line1 || ''}
                    onChange={(e) => updatePhysicalAddressField('line1', e.target.value)}
                    placeholder="Address line 1"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                  <input
                    type="text"
                    value={profile?.physical_address?.line2 || ''}
                    onChange={(e) => updatePhysicalAddressField('line2', e.target.value)}
                    placeholder="Address line 2 (optional)"
                    className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={profile?.physical_address?.city || ''}
                      onChange={(e) => updatePhysicalAddressField('city', e.target.value)}
                      placeholder="City"
                      className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    />
                    <input
                      type="text"
                      value={profile?.physical_address?.state || ''}
                      onChange={(e) => updatePhysicalAddressField('state', e.target.value)}
                      placeholder="State"
                      className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    />
                    <input
                      type="text"
                      value={profile?.physical_address?.zip || ''}
                      onChange={(e) => updatePhysicalAddressField('zip', e.target.value)}
                      placeholder="ZIP"
                      className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Save */}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => { void handleSaveProfile(); }}
                disabled={savingProfile || !profileDirty}
                className="btn-info disabled:opacity-50 disabled:cursor-not-allowed font-medium gap-2 inline-flex items-center rounded-md text-sm"
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
      case 'modules': {
        const renderModuleRow = (mod: ConfigurableModule) => {
          const isEnabled = moduleSettings?.[mod.key] ?? false;
          const isToggling = togglingModule === mod.key;
          return (
            <div
              key={mod.key}
              className={`flex items-center justify-between py-3 px-3 rounded-lg border transition-colors ${
                isEnabled
                  ? 'border-theme-accent-green/30 bg-theme-accent-green-muted'
                  : 'border-theme-surface-border bg-theme-surface-secondary/30'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                  isEnabled ? 'bg-theme-accent-green-muted text-theme-accent-green' : 'bg-theme-surface-secondary text-theme-text-muted'
                }`}>
                  {mod.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${isEnabled ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                      {mod.name}
                    </p>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${
                      isEnabled
                        ? 'bg-theme-accent-green-muted text-theme-accent-green'
                        : 'bg-theme-surface-secondary text-theme-text-muted'
                    }`}>
                      {isEnabled ? (
                        <><Check className="w-3 h-3" /> Enabled</>
                      ) : (
                        <><X className="w-3 h-3" /> Disabled</>
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-theme-text-muted truncate">{mod.description}</p>
                </div>
              </div>
              <div className="shrink-0 ml-4">
                <button
                  type="button"
                  onClick={() => { void handleModuleToggle(mod.key); }}
                  disabled={isToggling}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isEnabled
                      ? 'btn-secondary hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400'
                      : 'btn-success'
                  }`}
                  aria-label={isEnabled ? `Disable ${mod.name}` : `Enable ${mod.name}`}
                >
                  {isToggling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isEnabled ? (
                    'Disable'
                  ) : (
                    'Enable'
                  )}
                </button>
              </div>
            </div>
          );
        };

        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-theme-text-primary">Modules</h3>
                <p className="text-sm text-theme-text-muted mt-1">
                  Enable or disable optional modules. Core modules (Members, Events, Documents) are always active.
                </p>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-theme-accent-green-muted text-theme-accent-green">
                {enabledCount} / {CONFIGURABLE_MODULES.length} enabled
              </span>
            </div>

            {/* Standard modules */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                Standard Modules
              </h4>
              <div className="space-y-1.5">
                {STANDARD_MODULES.map(renderModuleRow)}
              </div>
            </div>

            {/* Additional modules */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                Additional Modules
              </h4>
              <div className="space-y-1.5">
                {ADDITIONAL_MODULES.map(renderModuleRow)}
              </div>
            </div>
          </div>
        );
      }

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
                  onClick={() => { void handleSaveContact(); }}
                  disabled={savingContact}
                  className="btn-info disabled:opacity-50 disabled:cursor-not-allowed font-medium gap-2 inline-flex items-center rounded-md text-sm"
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
                        className="w-40 rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
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
                          className="w-40 rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end mt-4">
                <button
                  onClick={() => { void handleSaveMembershipId(); }}
                  disabled={savingMembershipId}
                  className="btn-info disabled:opacity-50 disabled:cursor-not-allowed font-medium gap-2 inline-flex items-center rounded-md text-sm"
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
          <RanksSettingsSection
            ranks={ranks}
            ranksLoading={ranksLoading}
            editingRank={editingRank}
            addingRank={addingRank}
            rankForm={rankForm}
            rankSaving={rankSaving}
            deletingRankId={deletingRankId}
            editingPositionsRankId={editingPositionsRankId}
            rankValidationIssues={rankValidationIssues}
            onSetEditingRank={setEditingRank}
            onSetAddingRank={setAddingRank}
            onSetRankForm={setRankForm}
            onSetEditingPositionsRankId={setEditingPositionsRankId}
            onAddRank={() => { void handleAddRank(); }}
            onUpdateRank={() => { void handleUpdateRank(); }}
            onDeleteRank={(id) => { void handleDeleteRank(id); }}
            onMoveRank={(index, direction) => { void handleMoveRank(index, direction); }}
            onToggleEligiblePosition={(rank, pos) => { void handleToggleEligiblePosition(rank, pos); }}
          />
        );

      // ════════════════════════════════════════════
      // EMAIL
      // ════════════════════════════════════════════
      case 'email':
        return (
          <EmailSettingsSection
            emailSettings={emailSettings}
            onEmailSettingsChange={setEmailSettings}
            savingEmail={savingEmail}
            emailPasswordVisible={emailPasswordVisible}
            onTogglePasswordVisible={() => setEmailPasswordVisible(!emailPasswordVisible)}
            onSave={() => { void handleSaveEmail(); }}
            profileName={profile?.name}
          />
        );

      // ════════════════════════════════════════════
      // STORAGE
      // ════════════════════════════════════════════
      case 'storage':
        return (
          <StorageSettingsSection
            storageSettings={storageSettings}
            onStorageSettingsChange={setStorageSettings}
            savingStorage={savingStorage}
            storageSecretVisible={storageSecretVisible}
            onToggleSecretVisible={() => setStorageSecretVisible(!storageSecretVisible)}
            onSave={() => { void handleSaveStorage(); }}
          />
        );

      // ════════════════════════════════════════════
      // AUTHENTICATION
      // ════════════════════════════════════════════
      case 'authentication':
        return (
          <AuthSettingsSection
            authSettings={authSettings}
            onAuthSettingsChange={setAuthSettings}
            savingAuth={savingAuth}
            authSecretVisible={authSecretVisible}
            onToggleSecretVisible={() => setAuthSecretVisible(!authSecretVisible)}
            onSave={() => { void handleSaveAuth(); }}
          />
        );
    }
  };

  // ── Main layout: sidebar + content ──

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-theme-text-primary">Organization Settings</h2>
            <p className="mt-1 text-sm text-theme-text-muted">
              Manage your department profile, modules, and configuration.
            </p>
          </div>
          <HelpLink
            topic="settings"
            tooltip="Configure your department's name, logo, timezone, modules, member settings, and rank structure from this page."
          />
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Mobile: horizontal scrollable tabs */}
          <nav className="md:hidden -mx-4 px-4 border-b border-theme-surface-border" aria-label="Settings sections">
            <div className="flex overflow-x-auto scrollbar-thin scroll-smooth gap-1 pb-2">
              {SECTIONS.map(({ key, label, icon: Icon }) => {
                const isActive = activeSection === key;
                return (
                  <button
                    key={key}
                    onClick={() => switchSection(key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-colors focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring ${
                      isActive
                        ? 'bg-theme-accent-blue-muted text-theme-accent-blue'
                        : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} />
                    {label}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Desktop: sidebar */}
          <nav className="hidden md:block md:w-56 shrink-0" aria-label="Settings sections">
            <div className="md:sticky md:top-24 space-y-1">
              {SECTIONS.map(({ key, label, icon: Icon, description }) => {
                const isActive = activeSection === key;
                return (
                  <button
                    key={key}
                    onClick={() => switchSection(key)}
                    className={`w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring ${
                      isActive
                        ? 'bg-theme-accent-blue-muted text-theme-accent-blue'
                        : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{label}</p>
                      <p className={`text-xs ${isActive ? 'text-theme-accent-blue/70' : 'text-theme-text-muted'}`}>
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
            <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-4 sm:p-6">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
