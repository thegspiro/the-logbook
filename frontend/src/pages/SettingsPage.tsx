/**
 * Settings Page
 *
 * Organization settings with a sidebar navigation and content panel.
 * Sections: General, Modules, Members, Ranks, Email, Storage, Authentication.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router';
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
  Truck,
  MessageSquare,
  Briefcase,
  DollarSign,
  UserPlus,
  Globe,
  HardDrive,
  Key,
  Store,
  Stethoscope,
  ClipboardCheck,
  HeartPulse,
  Wallet,
  Printer,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import { HelpLink } from '../components/HelpLink';
import { organizationService, ranksService } from '../services/api';
import type {
  ModuleSettingsData,
  OperationalRankResponse,
  OrganizationProfile,
  RankValidationIssue,
} from '../services/api';
import type {
  ContactInfoSettings,
  MembershipIdSettings,
  EmailServiceSettings,
  FileStorageSettings,
  AuthSettings,
} from '../types/user';
import { invalidateRanksCache } from '../hooks/useRanks';
import { useAuthStore } from '../stores/authStore';
import EmailSettingsSection from '../components/settings/EmailSettingsSection';
import StorageSettingsSection from '../components/settings/StorageSettingsSection';
import AuthSettingsSection from '../components/settings/AuthSettingsSection';
import { MfaPolicyCard } from '../components/settings/MfaPolicyCard';
import RanksSettingsSection from '../components/settings/RanksSettingsSection';
import EvocLevelsSettingsSection from '../components/settings/EvocLevelsSettingsSection';
import LabelPrintersSection from '../components/settings/LabelPrintersSection';
import { SettingsLayout, type SettingsSection } from '../components/settings/SettingsLayout';
import SettingsPanelHead from '../components/settings/SettingsPanelHead';
import { SettingsToggle as Toggle } from '../components/settings/SettingsToggle';
import { useSettingsAutosave } from '../hooks/useSettingsAutosave';

// ── Section definitions ──

type SectionKey =
  'general' | 'modules' | 'members' | 'ranks' | 'email' | 'storage' | 'labelPrinters' | 'authentication';

/**
 * Sub-pages across every section. One flat union rather than one per section:
 * the URL carries a single `?page=` value, so the parser needs one type to
 * validate against, and the shell keys the rail off the active section anyway.
 */
type SubPageKey =
  | 'profile'
  | 'contact'
  | 'addresses'
  | 'standard'
  | 'additional'
  | 'visibility'
  | 'ids'
  | 'operational'
  | 'evoc'
  | 'signin'
  | 'mfa';

const SECTIONS: SettingsSection<SectionKey, SubPageKey>[] = [
  {
    key: 'general',
    label: 'General',
    icon: Building2,
    description: 'Department name, logo, timezone, and contact info',
    subPages: [
      { key: 'profile', label: 'Profile', hint: 'Name, logo, timezone' },
      { key: 'contact', label: 'Contact', hint: 'Phone, email, website' },
      { key: 'addresses', label: 'Addresses', hint: 'Mailing and physical' },
    ],
  },
  {
    key: 'modules',
    label: 'Modules',
    icon: Package,
    description: 'Enable or disable optional features',
    subPages: [
      { key: 'standard', label: 'Standard Modules', hint: 'On by default' },
      { key: 'additional', label: 'Additional Modules', hint: 'Opt-in' },
    ],
  },
  {
    key: 'members',
    label: 'Members',
    icon: Users,
    description: 'Contact visibility and membership IDs',
    subPages: [
      { key: 'visibility', label: 'Contact Visibility', hint: 'What members see of each other' },
      { key: 'ids', label: 'Membership IDs', hint: 'Numbering and prefixes' },
    ],
  },
  {
    key: 'ranks',
    label: 'Ranks',
    icon: Shield,
    // EVOC was its own top-level section, which put a driver-certification
    // ladder beside Email and Storage as though it were a department-wide
    // platform choice. It is a second rank ladder, so it belongs under Ranks.
    description: 'Operational rank ladder and driver certification',
    subPages: [
      { key: 'operational', label: 'Operational Ranks', hint: 'Order and eligibility' },
      { key: 'evoc', label: 'EVOC Levels', hint: 'Driver certification ladder' },
    ],
  },
  { key: 'email', label: 'Email', icon: Mail, description: 'Email platform and notification settings' },
  { key: 'storage', label: 'Storage', icon: HardDrive, description: 'File storage platform configuration' },
  {
    key: 'labelPrinters',
    label: 'Label Printers',
    icon: Printer,
    description: 'Network barcode label printers',
  },
  {
    key: 'authentication',
    label: 'Authentication',
    icon: Key,
    description: 'User sign-in and SSO provider',
    subPages: [
      { key: 'signin', label: 'Sign-in', hint: 'Local accounts and SSO' },
      { key: 'mfa', label: 'MFA Policy', hint: 'Who must enrol' },
    ],
  },
];

/** First sub-page of each section, used when a section is selected fresh. */
/**
 * Sections whose controls write on change. The rest keep an explicit Save
 * because they write credentials, and the autosave pill is hidden on those —
 * a pill still reading "All changes saved" from an earlier section would be
 * describing a write that is not going to happen.
 */
const AUTOSAVED_SECTIONS = new Set<SectionKey>(['general', 'modules', 'members', 'ranks']);

const DEFAULT_SUB_PAGE = new Map<SectionKey, SubPageKey | null>(
  SECTIONS.map((section) => [section.key, section.subPages?.[0]?.key ?? null])
);

// ── Module definitions ──

interface ConfigurableModule {
  key: keyof ModuleSettingsData;
  name: string;
  description: string;
  icon: React.ReactNode;
}

/** Standard modules — enabled by default for all organizations */
const STANDARD_MODULES: ConfigurableModule[] = [
  {
    key: 'training',
    name: 'Training & Certification',
    description: 'Course management, certification tracking, and compliance monitoring',
    icon: <GraduationCap className="h-5 w-5" />,
  },
  {
    key: 'inventory',
    name: 'Inventory Management',
    description: 'Equipment tracking, supply levels, and procurement',
    icon: <Package className="h-5 w-5" />,
  },
  {
    key: 'scheduling',
    name: 'Scheduling',
    description: 'Duty rosters, shift scheduling, and calendar management',
    icon: <Calendar className="h-5 w-5" />,
  },
  {
    key: 'apparatus',
    name: 'Apparatus Management',
    description: 'Vehicle tracking, maintenance schedules, and equipment inventory',
    icon: <Truck className="h-5 w-5" />,
  },
  {
    key: 'minutes',
    name: 'Meeting Minutes',
    description: 'Meeting documentation, attendance tracking, and action items',
    icon: <FileText className="h-5 w-5" />,
  },
  {
    key: 'reports',
    name: 'Reports & Analytics',
    description: 'Custom reports, data export, and analytics dashboards',
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    key: 'notifications',
    name: 'Email Notifications',
    description: 'Automated email alerts and notification rules',
    icon: <Bell className="h-5 w-5" />,
  },
  {
    key: 'forms',
    name: 'Custom Forms',
    description: 'Form builder for inspections, surveys, and data collection',
    icon: <ClipboardList className="h-5 w-5" />,
  },
  {
    key: 'integrations',
    name: 'External Integrations',
    description: 'Third-party service connections and API access',
    icon: <Plug className="h-5 w-5" />,
  },
  {
    key: 'facilities',
    name: 'Facilities Management',
    description: 'Building management, maintenance scheduling, and inspections',
    icon: <Building2 className="h-5 w-5" />,
  },
  {
    key: 'prospective_members',
    name: 'Prospective Members',
    description: 'Applicant-to-member pipeline with configurable stages',
    icon: <UserPlus className="h-5 w-5" />,
  },
  {
    key: 'public_info',
    name: 'Public Information',
    description: 'Public-facing pages, community outreach, and fire safety education',
    icon: <Globe className="h-5 w-5" />,
  },
];

/** Additional modules — disabled by default, opt-in */
const ADDITIONAL_MODULES: ConfigurableModule[] = [
  {
    key: 'communications',
    name: 'Communications',
    description: 'Internal messaging, announcements, and notifications',
    icon: <MessageSquare className="h-5 w-5" />,
  },
  {
    key: 'elections',
    name: 'Elections & Voting',
    description: 'Ballot creation, voting management, and election results',
    icon: <Vote className="h-5 w-5" />,
  },
  {
    key: 'mobile',
    name: 'Mobile App Access',
    description: 'Mobile-optimized access with pull-to-refresh and responsive UI',
    icon: <Smartphone className="h-5 w-5" />,
  },
  {
    key: 'incidents',
    name: 'Incidents & Reports',
    description: 'Incident logging, run reports, and analytics',
    icon: <FileText className="h-5 w-5" />,
  },
  {
    key: 'hr_payroll',
    name: 'HR & Payroll',
    description: 'Time tracking, compensation, and benefits management',
    icon: <Briefcase className="h-5 w-5" />,
  },
  {
    key: 'grants',
    name: 'Grants & Fundraising',
    description: 'Grant tracking, fundraising campaigns, and budget management',
    icon: <DollarSign className="h-5 w-5" />,
  },
  {
    key: 'storefront',
    name: 'Department Store',
    description:
      'Sell apparel and gear to members with open/close order windows, paid via Venmo, PayPal, cash, or check',
    icon: <Store className="h-5 w-5" />,
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Budgets, member dues, expenses, purchase requests, and check requests',
    icon: <Wallet className="h-5 w-5" />,
  },
  {
    key: 'medical_screening',
    name: 'Medical Screening',
    description: 'Member physicals, clearances, and expiration tracking',
    icon: <HeartPulse className="h-5 w-5" />,
  },
  {
    key: 'medical_supplies',
    name: 'Medical Supplies',
    description:
      'EMS stock with lot numbers and expiration dates, tracked separately from gear so it can have its own supply officer',
    icon: <Stethoscope className="h-5 w-5" />,
  },
  {
    key: 'testing',
    name: 'Testing Checklist',
    description:
      "A tester's index of every page in the app, with each page's permission gate — for walking a new installation before it goes live",
    icon: <ClipboardCheck className="h-5 w-5" />,
  },
];

// ── Timezone helper ──

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Indiana/Indianapolis',
  'America/Detroit',
  'America/Kentucky/Louisville',
];

// ── Main component ──

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const checkPermission = useAuthStore((state) => state.checkPermission);

  // EVOC levels are served by the apparatus API, which this page's own
  // settings.manage grant does not cover — hide the section rather than show a
  // tab that can only 403.
  const canManageEvoc = checkPermission('apparatus.manage');
  // EVOC is a sub-page of Ranks rather than a section of its own, so the gate
  // drops that one page and leaves the rest of the rail — a section is only
  // dropped outright when every page under it is gated, which is not the case
  // here (Operational Ranks stays).
  const sections = useMemo(
    () =>
      SECTIONS.map((section) => {
        if (section.key !== 'ranks' || canManageEvoc) {
          return section;
        }
        return { ...section, subPages: (section.subPages ?? []).filter((page) => page.key !== 'evoc') };
      }),
    [canManageEvoc]
  );
  const sectionKeys = useMemo(() => new Set<string>(sections.map((s) => s.key)), [sections]);

  const requestedTab = searchParams.get('tab');
  const requestedPage = searchParams.get('page');

  /**
   * EVOC was a top-level section until this screen gained sub-pages, and the
   * old UI put `?tab=evoc` in the address bar itself — so those links are in
   * members' bookmarks and in messages already sent. Without this they would
   * fail the section check and land silently on General, which looks like the
   * settings were moved out from under them rather than merely renamed.
   */
  const initialTab = requestedTab === 'evoc' ? 'ranks' : requestedTab;
  const initialPage = requestedTab === 'evoc' ? 'evoc' : requestedPage;

  const [activeSection, setActiveSection] = useState<SectionKey>(
    initialTab && sectionKeys.has(initialTab) ? (initialTab as SectionKey) : 'general'
  );

  const [activeSubPage, setActiveSubPage] = useState<SubPageKey | null>(() => {
    const section = sections.find(
      (s) => s.key === (initialTab && sectionKeys.has(initialTab) ? initialTab : 'general')
    );
    const isValid = section?.subPages?.some((page) => page.key === initialPage) ?? false;
    return isValid ? (initialPage as SubPageKey) : (section?.subPages?.[0]?.key ?? null);
  });

  const { saveState, save, saveDebounced, retry } = useSettingsAutosave();
  const [loading, setLoading] = useState(true);

  // General / profile state
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Module state
  const [moduleSettings, setModuleSettings] = useState<ModuleSettingsData | null>(null);
  const [togglingModule, setTogglingModule] = useState<string | null>(null);

  // Contact info state
  const [contactSettings, setContactSettings] = useState<ContactInfoSettings>({
    enabled: false,
    show_email: true,
    show_phone: true,
    show_mobile: true,
  });

  // Membership ID state
  const [membershipId, setMembershipId] = useState<MembershipIdSettings>({
    enabled: false,
    auto_generate: false,
    prefix: '',
    next_number: 1,
  });

  // Email settings state
  const [emailSettings, setEmailSettings] = useState<EmailServiceSettings>({
    enabled: false,
    platform: 'other',
    smtp_port: 587,
    smtp_encryption: 'tls',
    use_tls: true,
  });
  const [savingEmail, setSavingEmail] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  // Read at result time so a connection test can tell whether the form it
  // was sent for is still the form on screen.
  const emailSettingsRef = useRef<EmailServiceSettings>(emailSettings);
  useEffect(() => {
    emailSettingsRef.current = emailSettings;
  }, [emailSettings]);
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

  // Both levels are mirrored to the URL with `replace`, so a settings screen
  // can be linked to and refreshed without stacking a history entry per click.
  const writeUrl = useCallback(
    (section: SectionKey, page: SubPageKey | null) => {
      const next: Record<string, string> = {};
      if (section !== 'general') {
        next['tab'] = section;
      }
      // The first sub-page is what a bare `?tab=` already means, so leaving it
      // out keeps the common link short and the two forms equivalent.
      if (page !== null && page !== DEFAULT_SUB_PAGE.get(section)) {
        next['page'] = page;
      }
      setSearchParams(next, { replace: true });
    },
    [setSearchParams]
  );

  const switchSection = useCallback(
    (key: SectionKey) => {
      const first = sections.find((s) => s.key === key)?.subPages?.[0]?.key ?? null;
      setActiveSection(key);
      setActiveSubPage(first);
      writeUrl(key, first);
    },
    [sections, writeUrl]
  );

  const switchSubPage = useCallback(
    (key: SubPageKey) => {
      setActiveSubPage(key);
      writeUrl(activeSection, key);
    },
    [activeSection, writeUrl]
  );

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
    } catch {
      /* empty state shown */
    } finally {
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
        // The autosave savers read these refs at fire time, so the loaded
        // values have to land in both or the first edit would write a payload
        // built on the pre-load defaults.
        setContactSettings(settingsData.contact_info_visibility);
        contactSettingsRef.current = settingsData.contact_info_visibility;
        if (settingsData.membership_id) {
          setMembershipId(settingsData.membership_id);
          membershipIdRef.current = settingsData.membership_id;
        }
        if (settingsData.email_service) setEmailSettings(settingsData.email_service);
        if (settingsData.file_storage) setStorageSettings(settingsData.file_storage);
        if (settingsData.auth) setAuthSettings(settingsData.auth);
        setModuleSettings(modulesData.module_settings);
        setProfile(profileData);
        profileRef.current = profileData;
      } catch {
        toast.error('Unable to load settings.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [fetchRanks]);

  // ── Profile handlers ──

  /**
   * Writes the profile and re-syncs the branding the app shell reads.
   *
   * Deliberately does not feed the response back into `profile`. Saves are
   * debounced behind the member's typing, so a response landing mid-keystroke
   * would overwrite the characters typed since the request went out — the
   * field would appear to swallow input at random. The local value is already
   * what they asked for; only the branding mirror needs the server's copy.
   */
  const persistProfile = useCallback(async (next: OrganizationProfile) => {
    const updated = await organizationService.updateProfile(next);
    localStorage.setItem('departmentName', updated.name);
    if (updated.logo) {
      localStorage.setItem('logoData', updated.logo);
    } else {
      localStorage.removeItem('logoData');
    }
    window.dispatchEvent(
      new CustomEvent('branding-updated', {
        detail: { name: updated.name, logo: updated.logo },
      })
    );
  }, []);

  /**
   * Mirrors `profile` for the savers to read at fire time.
   *
   * A debounced write that closed over the value it was scheduled with would
   * send that snapshot 600ms later, undoing anything changed in between — flip
   * a switch while a typed name is still pending and the pending save writes
   * the switch back to its old value.
   */
  const profileRef = useRef<OrganizationProfile | null>(profile);

  const applyProfile = (next: OrganizationProfile, { immediate }: { immediate: boolean }) => {
    profileRef.current = next;
    setProfile(next);
    const write = () => persistProfile(profileRef.current ?? next);
    // A picked logo or timezone is a finished decision; a typed name is not.
    if (immediate) {
      void save(write);
    } else {
      saveDebounced('profile', write);
    }
  };

  const updateProfileField = <K extends keyof OrganizationProfile>(
    field: K,
    value: OrganizationProfile[K],
    { immediate = false }: { immediate?: boolean } = {}
  ) => {
    const current = profileRef.current ?? profile;
    if (!current) return;
    applyProfile({ ...current, [field]: value }, { immediate });
  };

  const updateAddressField = (field: string, value: string) => {
    const current = profileRef.current ?? profile;
    if (!current) return;
    applyProfile({ ...current, mailing_address: { ...current.mailing_address, [field]: value } }, { immediate: false });
  };

  const updatePhysicalAddressField = (field: string, value: string) => {
    const current = profileRef.current ?? profile;
    if (!current) return;
    applyProfile(
      { ...current, physical_address: { ...current.physical_address, [field]: value } },
      { immediate: false }
    );
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be under 2 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateProfileField('logo', reader.result as string, { immediate: true });
    };
    reader.readAsDataURL(file);
  };

  // ── Module handlers ──

  const handleModuleToggle = (moduleKey: keyof ModuleSettingsData) => {
    if (!moduleSettings || togglingModule) return;
    const newValue = !moduleSettings[moduleKey];
    setTogglingModule(moduleKey);
    void save(async () => {
      try {
        const result = await organizationService.updateModuleSettings({ [moduleKey]: newValue });
        setModuleSettings(result.module_settings);
      } finally {
        setTogglingModule(null);
      }
    });
  };

  // ── Contact info handlers ──

  const contactSettingsRef = useRef<ContactInfoSettings>(contactSettings);

  const updateContactSetting = (patch: Partial<ContactInfoSettings>) => {
    const next = { ...contactSettingsRef.current, ...patch };
    contactSettingsRef.current = next;
    setContactSettings(next);
    void save(() => organizationService.updateContactInfoSettings(next));
  };

  // ── Membership ID handlers ──

  const membershipIdRef = useRef<MembershipIdSettings>(membershipId);

  const updateMembershipIdSetting = (patch: Partial<MembershipIdSettings>, { immediate = false } = {}) => {
    const next = { ...membershipIdRef.current, ...patch };
    membershipIdRef.current = next;
    setMembershipId(next);
    // Read at fire time, for the same reason as the profile above.
    const write = () => organizationService.updateMembershipIdSettings(membershipIdRef.current);
    if (immediate) {
      void save(write);
    } else {
      saveDebounced('membership-id', write);
    }
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
      // A 400 names the field an enabled platform still needs; show it
      // rather than a generic failure the admin cannot act on.
      toast.error(
        status === 403
          ? 'Permission denied.'
          : status === 400
            ? getErrorMessage(err, 'Failed to save email settings.')
            : 'Failed to save email settings.'
      );
    } finally {
      setSavingEmail(false);
    }
  };

  const handleTestEmail = async () => {
    // A test takes up to 30 seconds. If the admin edits the form while it
    // runs, the result describes values that are no longer on screen, and a
    // green toast over a since-changed password would vouch for a
    // configuration nobody has tested.
    const submitted = emailSettings;
    setTestingEmail(true);
    try {
      const result = await organizationService.testEmailSettings(submitted);
      if (emailSettingsRef.current !== submitted) {
        toast.error('Email settings changed while the test was running. Test again.');
        return;
      }
      if (result.success) {
        toast.success(result.message || 'Email connection test successful');
      } else {
        toast.error(result.message || 'Email connection test failed');
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(
        status === 403
          ? 'Permission denied.'
          : status === 429
            ? 'Too many connection tests. Wait a minute and try again.'
            : getErrorMessage(err, 'Failed to test email connection.')
      );
    } finally {
      setTestingEmail(false);
    }
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
    } finally {
      setSavingStorage(false);
    }
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
    } finally {
      setSavingAuth(false);
    }
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
    } catch {
      toast.error('Failed to remove rank');
    } finally {
      setDeletingRankId(null);
    }
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
    } catch {
      toast.error('Failed to reorder');
      await fetchRanks();
    }
  };

  const handleToggleEligiblePosition = async (rank: OperationalRankResponse, position: string) => {
    const current = rank.eligible_positions ?? [];
    const updated = current.includes(position) ? current.filter((p) => p !== position) : [...current, position];
    try {
      await ranksService.updateRank(rank.id, { eligible_positions: updated });
      setRanks((prev) => prev.map((r) => (r.id === rank.id ? { ...r, eligible_positions: updated } : r)));
    } catch {
      toast.error('Failed to update eligible positions');
    }
  };

  // ── Loading state ──

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  // ── Render section content ──

  const renderContent = () => {
    switch (activeSection) {
      // ════════════════════════════════════════════
      // GENERAL
      // ════════════════════════════════════════════
      case 'general':
        if (activeSubPage === 'contact') {
          return (
            <div className="space-y-6">
              <SettingsPanelHead
                title="Contact Information"
                description="How the public and other agencies reach the station."
              />
              {/* Contact */}
              <div>
                <p className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-medium">
                  <Phone className="text-theme-text-muted h-4 w-4" /> Contact Information
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-theme-text-muted mb-1 block text-xs">Phone</label>
                    <input
                      type="text"
                      value={profile?.phone || ''}
                      onChange={(e) => updateProfileField('phone', e.target.value)}
                      placeholder="(555) 123-4567"
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="text-theme-text-muted mb-1 block text-xs">Email</label>
                    <input
                      type="email"
                      value={profile?.email || ''}
                      onChange={(e) => updateProfileField('email', e.target.value)}
                      placeholder="info@firedept.org"
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="text-theme-text-muted mb-1 block text-xs">Website</label>
                    <input
                      type="url"
                      value={profile?.website || ''}
                      onChange={(e) => updateProfileField('website', e.target.value)}
                      placeholder="https://firedept.org"
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="text-theme-text-muted mb-1 block text-xs">County</label>
                    <input
                      type="text"
                      value={profile?.county || ''}
                      onChange={(e) => updateProfileField('county', e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (activeSubPage === 'addresses') {
          return (
            <div className="space-y-6">
              <SettingsPanelHead title="Addresses" description="Mailing and physical location." />
              {/* Mailing Address */}
              <div>
                <p className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-medium">
                  <MapPin className="text-theme-text-muted h-4 w-4" /> Mailing Address
                </p>
                <div className="grid grid-cols-1 gap-3">
                  <input
                    type="text"
                    value={profile?.mailing_address?.line1 || ''}
                    onChange={(e) => updateAddressField('line1', e.target.value)}
                    placeholder="Address line 1"
                    className="form-input"
                  />
                  <input
                    type="text"
                    value={profile?.mailing_address?.line2 || ''}
                    onChange={(e) => updateAddressField('line2', e.target.value)}
                    placeholder="Address line 2 (optional)"
                    className="form-input"
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      type="text"
                      value={profile?.mailing_address?.city || ''}
                      onChange={(e) => updateAddressField('city', e.target.value)}
                      placeholder="City"
                      className="form-input"
                    />
                    <input
                      type="text"
                      value={profile?.mailing_address?.state || ''}
                      onChange={(e) => updateAddressField('state', e.target.value)}
                      placeholder="State"
                      className="form-input"
                    />
                    <input
                      type="text"
                      value={profile?.mailing_address?.zip || ''}
                      onChange={(e) => updateAddressField('zip', e.target.value)}
                      placeholder="ZIP"
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              {/* Physical Address */}
              <div>
                <p className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-medium">
                  <MapPin className="text-theme-text-muted h-4 w-4" /> Physical Address
                </p>
                <label className="text-theme-text-secondary mb-3 flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={profile?.physical_address_same ?? true}
                    onChange={(e) => updateProfileField('physical_address_same', e.target.checked)}
                    className="border-theme-input-border rounded text-red-600 focus:ring-red-500"
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
                      className="form-input"
                    />
                    <input
                      type="text"
                      value={profile?.physical_address?.line2 || ''}
                      onChange={(e) => updatePhysicalAddressField('line2', e.target.value)}
                      placeholder="Address line 2 (optional)"
                      className="form-input"
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <input
                        type="text"
                        value={profile?.physical_address?.city || ''}
                        onChange={(e) => updatePhysicalAddressField('city', e.target.value)}
                        placeholder="City"
                        className="form-input"
                      />
                      <input
                        type="text"
                        value={profile?.physical_address?.state || ''}
                        onChange={(e) => updatePhysicalAddressField('state', e.target.value)}
                        placeholder="State"
                        className="form-input"
                      />
                      <input
                        type="text"
                        value={profile?.physical_address?.zip || ''}
                        onChange={(e) => updatePhysicalAddressField('zip', e.target.value)}
                        placeholder="ZIP"
                        className="form-input"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          <div className="space-y-6">
            <SettingsPanelHead
              title="Department Profile"
              description="Basic information about your department."
              meta="Visible to every member"
            />
            {/* Logo */}
            <div className="flex items-start gap-4">
              <div className="border-theme-surface-border bg-theme-surface-secondary flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed">
                {profile?.logo ? (
                  <img
                    src={profile.logo}
                    alt={`${profile.name || 'Department'} logo`}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <Building2 className="text-theme-text-muted h-8 w-8" />
                )}
              </div>
              <div>
                <p className="text-theme-text-primary text-sm font-medium">Department Logo</p>
                <p className="text-theme-text-muted mb-2 text-xs">PNG, JPG, or SVG. Max 2 MB.</p>
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="text-theme-accent-blue inline-flex items-center gap-1.5 text-sm hover:opacity-80 max-md:min-h-[44px]"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload logo
                </button>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </div>
            </div>

            {/* Name + Timezone */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-theme-text-primary mb-1 block text-sm font-medium">Department Name</label>
                <input
                  type="text"
                  value={profile?.name || ''}
                  onChange={(e) => updateProfileField('name', e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="text-theme-text-primary mb-1 block text-sm font-medium">Timezone</label>
                <select
                  value={profile?.timezone || 'America/New_York'}
                  onChange={(e) => updateProfileField('timezone', e.target.value, { immediate: true })}
                  className="form-input"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
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
              className={`flex items-center justify-between rounded-lg border px-3 py-3 transition-colors ${
                isEnabled
                  ? 'border-theme-accent-green/30 bg-theme-accent-green-muted'
                  : 'border-theme-surface-border bg-theme-surface-secondary/30'
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isEnabled
                      ? 'bg-theme-accent-green-muted text-theme-accent-green'
                      : 'bg-theme-surface-secondary text-theme-text-muted'
                  }`}
                >
                  {mod.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-sm font-medium ${isEnabled ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}
                    >
                      {mod.name}
                    </p>
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
                        isEnabled
                          ? 'bg-theme-accent-green-muted text-theme-accent-green'
                          : 'bg-theme-surface-secondary text-theme-text-muted'
                      }`}
                    >
                      {isEnabled ? (
                        <>
                          <Check className="h-3 w-3" /> Enabled
                        </>
                      ) : (
                        <>
                          <X className="h-3 w-3" /> Disabled
                        </>
                      )}
                    </span>
                  </div>
                  <p className="text-theme-text-muted truncate text-xs">{mod.description}</p>
                </div>
              </div>
              <div className="ml-4 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    void handleModuleToggle(mod.key);
                  }}
                  disabled={isToggling}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:ring-2 focus:ring-offset-1 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 ${
                    isEnabled
                      ? 'btn-secondary hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400'
                      : 'btn-success'
                  }`}
                  aria-label={isEnabled ? `Disable ${mod.name}` : `Enable ${mod.name}`}
                >
                  {isToggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          );
        };

        if (activeSubPage === 'additional') {
          const enabled = ADDITIONAL_MODULES.filter((m) => moduleSettings?.[m.key]).length;
          return (
            <div>
              <SettingsPanelHead
                title="Additional Modules"
                description="Disabled by default, opt-in per department."
                meta={`${enabled} / ${ADDITIONAL_MODULES.length} enabled`}
              />
              <div className="space-y-1.5">{ADDITIONAL_MODULES.map(renderModuleRow)}</div>
            </div>
          );
        }

        return (
          <div>
            <SettingsPanelHead
              title="Standard Modules"
              description="Enabled by default for all organizations. Members, Events and Documents are core and always active."
              meta={`${STANDARD_MODULES.filter((m) => moduleSettings?.[m.key]).length} / ${STANDARD_MODULES.length} enabled`}
            />
            <div className="space-y-1.5">{STANDARD_MODULES.map(renderModuleRow)}</div>
          </div>
        );
      }

      // ════════════════════════════════════════════
      // MEMBERS
      // ════════════════════════════════════════════
      case 'members':
        if (activeSubPage === 'ids') {
          return (
            <div>
              <SettingsPanelHead
                title="Membership ID Number"
                description="Each member can be assigned a unique ID displayed on their profile."
                meta={membershipId.enabled ? `Next: ${membershipId.prefix}${membershipId.next_number}` : undefined}
              />
              <div className="space-y-3">
                <div className="border-theme-surface-border flex items-center justify-between border-b py-3">
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">Enable Membership ID Numbers</p>
                    <p className="text-theme-text-muted text-xs">Display membership IDs on member profiles and lists</p>
                  </div>
                  <Toggle
                    checked={membershipId.enabled}
                    onChange={() => updateMembershipIdSetting({ enabled: !membershipId.enabled }, { immediate: true })}
                  />
                </div>

                {membershipId.enabled && (
                  <div className="space-y-4 pl-4">
                    <div className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-theme-text-primary text-sm">Auto-Generate IDs</p>
                        <p className="text-theme-text-muted text-xs">
                          Automatically assign sequential IDs to new members
                        </p>
                      </div>
                      <Toggle
                        checked={membershipId.auto_generate}
                        onChange={() =>
                          updateMembershipIdSetting({ auto_generate: !membershipId.auto_generate }, { immediate: true })
                        }
                      />
                    </div>

                    <div>
                      <label className="text-theme-text-primary mb-1 block text-sm font-medium">ID Prefix</label>
                      <p className="text-theme-text-muted mb-2 text-xs">
                        Optional prefix (e.g. &quot;FD-&quot; produces FD-001)
                      </p>
                      <input
                        type="text"
                        maxLength={10}
                        value={membershipId.prefix}
                        onChange={(e) => updateMembershipIdSetting({ prefix: e.target.value })}
                        placeholder="e.g. FD-"
                        className="form-input w-40"
                      />
                    </div>

                    {membershipId.auto_generate && (
                      <div>
                        <label className="text-theme-text-primary mb-1 block text-sm font-medium">Next ID Number</label>
                        <p className="text-theme-text-muted mb-2 text-xs">
                          Next number assigned when a new member is added
                        </p>
                        <input
                          type="number"
                          min={1}
                          value={membershipId.next_number}
                          onChange={(e) =>
                            updateMembershipIdSetting({ next_number: Math.max(1, parseInt(e.target.value) || 1) })
                          }
                          className="form-input w-40"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          <div>
            <SettingsPanelHead
              title="Contact Information Visibility"
              description="Control what appears on the member list page."
            />
            <div className="space-y-3">
              <div className="border-theme-surface-border flex items-center justify-between border-b py-3">
                <div>
                  <p className="text-theme-text-primary text-sm font-medium">Show Contact Information</p>
                  <p className="text-theme-text-muted text-xs">Enable display of contact info for all members</p>
                </div>
                <Toggle
                  checked={contactSettings.enabled}
                  onChange={() => updateContactSetting({ enabled: !contactSettings.enabled })}
                />
              </div>

              {contactSettings.enabled && (
                <div className="space-y-3 pl-4">
                  <div className="flex items-center justify-between py-2">
                    <p className="text-theme-text-primary text-sm">Show Email Addresses</p>
                    <Toggle
                      checked={contactSettings.show_email}
                      onChange={() => updateContactSetting({ show_email: !contactSettings.show_email })}
                    />
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <p className="text-theme-text-primary text-sm">Show Phone Numbers</p>
                    <Toggle
                      checked={contactSettings.show_phone}
                      onChange={() => updateContactSetting({ show_phone: !contactSettings.show_phone })}
                    />
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <p className="text-theme-text-primary text-sm">Show Mobile Numbers</p>
                    <Toggle
                      checked={contactSettings.show_mobile}
                      onChange={() => updateContactSetting({ show_mobile: !contactSettings.show_mobile })}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      // ════════════════════════════════════════════
      // RANKS
      // ════════════════════════════════════════════
      case 'ranks':
        // EVOC is the same section's second page now, not a section of its own.
        if (activeSubPage === 'evoc') {
          return (
            <div>
              <SettingsPanelHead
                title="EVOC Levels"
                description="Driver certification ladder and certifying programs."
              />
              <EvocLevelsSettingsSection />
            </div>
          );
        }

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
            onAddRank={() => {
              void handleAddRank();
            }}
            onUpdateRank={() => {
              void handleUpdateRank();
            }}
            onDeleteRank={(id) => {
              void handleDeleteRank(id);
            }}
            onMoveRank={(index, direction) => {
              void handleMoveRank(index, direction);
            }}
            onToggleEligiblePosition={(rank, pos) => {
              void handleToggleEligiblePosition(rank, pos);
            }}
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
            testingEmail={testingEmail}
            emailPasswordVisible={emailPasswordVisible}
            onTogglePasswordVisible={() => setEmailPasswordVisible(!emailPasswordVisible)}
            onSave={() => {
              void handleSaveEmail();
            }}
            onTest={() => {
              void handleTestEmail();
            }}
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
            onSave={() => {
              void handleSaveStorage();
            }}
          />
        );

      // ════════════════════════════════════════════
      // LABEL PRINTERS
      // ════════════════════════════════════════════
      case 'labelPrinters':
        return <LabelPrintersSection />;

      // ════════════════════════════════════════════
      // AUTHENTICATION
      // ════════════════════════════════════════════
      case 'authentication':
        // Authentication keeps an explicit Save rather than autosaving: these
        // write credentials and change who can get in, and a half-typed SSO
        // secret dispatched on a debounce can lock the department out of its
        // own sign-in. The pill stays absent here for the same reason.
        if (activeSubPage === 'mfa') {
          return (
            <div>
              <SettingsPanelHead title="MFA Policy" description="Two-factor requirements for the department." />
              <MfaPolicyCard />
            </div>
          );
        }

        return (
          <div>
            <SettingsPanelHead title="Sign-in" description="How members sign in." />
            <AuthSettingsSection
              authSettings={authSettings}
              onAuthSettingsChange={setAuthSettings}
              savingAuth={savingAuth}
              authSecretVisible={authSecretVisible}
              onToggleSecretVisible={() => setAuthSecretVisible(!authSecretVisible)}
              onSave={() => {
                void handleSaveAuth();
              }}
            />
          </div>
        );
    }
  };

  // ── Main layout: sidebar + content ──

  return (
    <div className="min-h-screen">
      <SettingsLayout<SectionKey, SubPageKey>
        sections={sections}
        activeSection={activeSection}
        onSectionChange={switchSection}
        activeSubPage={activeSubPage}
        onSubPageChange={switchSubPage}
        navLabel="Settings sections"
        title="Organization Settings"
        subtitle="Department-wide configuration"
        saveState={AUTOSAVED_SECTIONS.has(activeSection) ? saveState : undefined}
        onRetrySave={retry}
        headerAside={
          <HelpLink
            topic="settings"
            tooltip="Configure your department's name, logo, timezone, modules, member settings, and rank structure from this page."
          />
        }
      >
        {renderContent()}
      </SettingsLayout>
    </div>
  );
};

export default SettingsPage;
