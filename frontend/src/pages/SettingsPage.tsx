/**
 * Settings Page
 *
 * Organization settings with a sidebar navigation and content panel.
 * Sections: General, Modules, Email, Storage, Label Printers, Authentication.
 *
 * Members settings and the rank ladder now live under Members Administration;
 * `?tab=` links to either are redirected below rather than dropped.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { membersSettingsPathFor } from './members/admin/settings/membersSettingsSections';
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
import { organizationService } from '../services/api';
import type { ModuleSettingsData, OrganizationProfile } from '../services/api';
import type { EmailServiceSettings, FileStorageSettings, AuthSettings } from '../types/user';
import EmailSettingsSection from '../components/settings/EmailSettingsSection';
import StorageSettingsSection from '../components/settings/StorageSettingsSection';
import AuthSettingsSection from '../components/settings/AuthSettingsSection';
import { MfaPolicyCard } from '../components/settings/MfaPolicyCard';
import LabelPrintersSection from '../components/settings/LabelPrintersSection';
import { SettingsLayout, type SettingsSection } from '../components/settings/SettingsLayout';
import SettingsPanelHead from '../components/settings/SettingsPanelHead';
import { useSettingsAutosave } from '../hooks/useSettingsAutosave';
import { useEmailConnectionTest } from '../hooks/useEmailConnectionTest';

// ── Section definitions ──

// `members` is deliberately absent: Contact Visibility and Membership IDs moved
// to /members/admin/settings on 2026-09-06. The union is hand-written rather
// than derived from `sections`, so removing the entry above does not remove the
// key here — and a stale key makes the render switch non-exhaustive, which is
// how a removed section becomes a blank panel instead of a compile error.
type SectionKey = 'general' | 'modules' | 'email' | 'storage' | 'labelPrinters' | 'authentication';

/**
 * Sub-pages across every section. One flat union rather than one per section:
 * the URL carries a single `?page=` value, so the parser needs one type to
 * validate against, and the shell keys the rail off the active section anyway.
 */
type SubPageKey =
  'profile' | 'contact' | 'addresses' | 'standard' | 'additional' | 'visibility' | 'ids' | 'signin' | 'mfa';

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
const AUTOSAVED_SECTIONS = new Set<SectionKey>(['general', 'modules']);

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

/** The two navigation arrangements AppLayout can render. */
const NAVIGATION_LAYOUTS: Array<{ value: 'top' | 'left'; label: string; hint: string }> = [
  { value: 'left', label: 'Left sidebar', hint: 'Navigation down the side. The default.' },
  { value: 'top', label: 'Top bar', hint: 'Navigation across the top, leaving the full width for content.' },
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

/**
 * Where the roster settings went.
 *
 * The sections that left this screen are still gated on grants this screen's
 * own holders have — the rank ladder accepts `settings.manage`, contact
 * visibility and membership IDs want settings grants outright — but their new
 * home is under `/members/admin`, whose hub and its links require
 * `members.manage`. An officer holding the settings grants and not that one
 * therefore kept the permission and lost every way of reaching it: the `?tab=`
 * redirects rescue an old bookmark, and nothing rescues someone simply looking
 * for the page.
 *
 * Rendered below the active section rather than as a section of its own, so it
 * is a signpost on the way past rather than a stop.
 */
const MovedToMembersAdmin: React.FC = () => (
  <div className="border-theme-surface-border mt-10 border-t pt-6">
    <p className="text-theme-text-muted text-sm">
      Contact visibility, membership IDs, operational ranks and EVOC levels moved to{' '}
      <Link
        to={membersSettingsPathFor('ranks')}
        className="text-theme-accent-blue mobile-touch-target inline-flex font-medium hover:underline"
      >
        Members Administration &rarr; Settings
      </Link>
      . They are decisions about the roster rather than platform configuration.
    </p>
  </div>
);

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Every remaining section stands on this page's own settings.manage grant, so
  // the rail is the static list. The per-section filtering that used to live
  // here went with Ranks: EVOC needed `apparatus.manage`, which this page's
  // grant does not cover, and that per-endpoint answer is now recorded beside
  // the section in `membersSettingsSections.ts`.
  const sections = SECTIONS;
  const sectionKeys = useMemo(() => new Set<string>(sections.map((s) => s.key)), [sections]);

  const requestedTab = searchParams.get('tab');
  const requestedPage = searchParams.get('page');

  /**
   * Members settings moved to `/members/admin/settings` on 2026-09-06, and
   * Ranks and EVOC followed on 2026-09-08. The old addresses are in bookmarks
   * and in links already sent.
   *
   * Redirected rather than remapped — this is the one case on this screen that
   * leaves the page entirely. Without it `?tab=members` fails the section check
   * below and lands on General, which looks like the settings were taken away
   * rather than moved: the same failure the EVOC remap under this exists to
   * prevent, one page further out.
   *
   * The sub-page carries across, so a link to Membership IDs arrives at
   * Membership IDs rather than at the first section of a screen the reader now
   * has to search.
   */
  const movedToMembersAdmin = ((): string | null => {
    if (requestedTab === 'members') {
      return membersSettingsPathFor(requestedPage === 'ids' ? 'ids' : 'visibility');
    }
    // Ranks followed on 2026-09-08, and it carries two legacy spellings rather
    // than one. `?tab=ranks&page=evoc` is the current address; bare `?tab=evoc`
    // is older still, from when EVOC was a top-level section, and this screen
    // has been remapping it ever since. Both are in bookmarks, so both are
    // answered here — dropping the older one now would strand exactly the links
    // that remap was written to rescue.
    if (requestedTab === 'evoc') {
      return membersSettingsPathFor('evoc');
    }
    if (requestedTab === 'ranks') {
      return membersSettingsPathFor(requestedPage === 'evoc' ? 'evoc' : 'ranks');
    }
    return null;
  })();

  const initialTab = requestedTab;
  const initialPage = requestedPage;

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

  // Email settings state
  const [emailSettings, setEmailSettings] = useState<EmailServiceSettings>({
    enabled: false,
    platform: 'other',
    smtp_port: 587,
    smtp_encryption: 'tls',
    use_tls: true,
  });
  const [savingEmail, setSavingEmail] = useState(false);
  // Wrapped rather than passed as a bare method reference: the service is a
  // plain object literal, and handing its method around unbound is what
  // `@typescript-eslint/unbound-method` exists to catch. Stable, so the
  // hook's callback identity does not churn on every render.
  const testEmailSettings = useCallback(
    (next: EmailServiceSettings) => organizationService.testEmailSettings(next),
    []
  );
  const { testing: testingEmail, runTest: handleTestEmail } = useEmailConnectionTest(emailSettings, testEmailSettings);
  const [emailPasswordVisible, setEmailPasswordVisible] = useState(false);

  // File storage state
  const [storageSettings, setStorageSettings] = useState<FileStorageSettings>({ platform: 'local' });
  const [savingStorage, setSavingStorage] = useState(false);
  const [storageSecretVisible, setStorageSecretVisible] = useState(false);

  // Authentication state
  const [authSettings, setAuthSettings] = useState<AuthSettings>({ provider: 'local' });
  const [savingAuth, setSavingAuth] = useState(false);
  const [authSecretVisible, setAuthSecretVisible] = useState(false);

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

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [settingsData, modulesData, profileData] = await Promise.all([
          organizationService.getSettings(),
          organizationService.getEnabledModules(),
          organizationService.getProfile(),
        ]);
        if (settingsData.email_service) setEmailSettings(settingsData.email_service);
        if (settingsData.file_storage) setStorageSettings(settingsData.file_storage);
        if (settingsData.auth) setAuthSettings(settingsData.auth);
        const layout = settingsData.appearance?.navigation_layout;
        if (layout === 'top' || layout === 'left') {
          setNavigationLayout(layout);
          navigationLayoutRef.current = layout;
        }
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
  }, []);

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
   * The department's navigation layout.
   *
   * Department-wide, not per-browser: this writes the organization setting
   * that every member's shell reads on load. Saved on change rather than
   * through the profile debounce — it is one finished choice from a pair of
   * radios, not a field somebody is still typing into.
   */
  const [navigationLayout, setNavigationLayout] = useState<'top' | 'left'>('left');
  /** Read inside the saver, which must not re-create itself on every change. */
  const navigationLayoutRef = useRef<'top' | 'left'>('left');
  const [savingLayout, setSavingLayout] = useState(false);

  const changeNavigationLayout = useCallback(async (layout: 'top' | 'left') => {
    const previous = navigationLayoutRef.current;
    setNavigationLayout(layout);
    navigationLayoutRef.current = layout;
    setSavingLayout(true);
    try {
      await organizationService.updateAppearanceSettings({ navigation_layout: layout });
      localStorage.setItem('navigationLayout', layout);
      // Same channel the name and logo use, so the shell re-arranges without
      // a reload for the person who made the change.
      window.dispatchEvent(new CustomEvent('branding-updated', { detail: { navigationLayout: layout } }));
      toast.success(layout === 'top' ? 'Navigation moved to the top bar' : 'Navigation moved to the sidebar');
    } catch {
      // Put the radio back where it was rather than leaving it showing a
      // choice the department did not get.
      setNavigationLayout(previous);
      navigationLayoutRef.current = previous;
      toast.error('Could not save the navigation layout.');
    } finally {
      setSavingLayout(false);
    }
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

  // ── Loading state ──

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  // Placed after every hook above: an early return before them would change the
  // hook count between renders. `replace`, because the old address is not a page
  // anybody should be able to go "back" to.
  if (movedToMembersAdmin) {
    return <Navigate to={movedToMembersAdmin} replace />;
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
              {/* `htmlFor`/`id`, not just proximity: neither control was wrapped
                  by its label, so a screen reader announced the department name
                  field and the timezone list as unnamed. Sighted proximity is
                  not an association. */}
              <div>
                <label
                  htmlFor="settings-department-name"
                  className="text-theme-text-primary mb-1 block text-sm font-medium"
                >
                  Department Name
                </label>
                <input
                  id="settings-department-name"
                  type="text"
                  value={profile?.name || ''}
                  onChange={(e) => updateProfileField('name', e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label htmlFor="settings-timezone" className="text-theme-text-primary mb-1 block text-sm font-medium">
                  Timezone
                </label>
                <select
                  id="settings-timezone"
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

            {/* Navigation layout */}
            <fieldset className="border-theme-surface-border mt-6 border-t pt-6">
              <legend className="sr-only">Navigation layout</legend>
              <p className="text-theme-text-primary text-sm font-medium">Navigation Layout</p>
              <p className="text-theme-text-muted mb-3 text-xs">
                Applies to everyone in the department, not just this browser.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {NAVIGATION_LAYOUTS.map((option) => (
                  <label
                    key={option.value}
                    className={`mobile-touch-target flex flex-1 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${
                      navigationLayout === option.value
                        ? 'border-theme-accent-green/30 bg-theme-accent-green-muted'
                        : 'border-theme-surface-border bg-theme-surface-secondary/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="navigation-layout"
                      value={option.value}
                      checked={navigationLayout === option.value}
                      disabled={savingLayout}
                      onChange={() => void changeNavigationLayout(option.value)}
                      className="form-checkbox mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="text-theme-text-primary block text-sm font-medium">{option.label}</span>
                      <span className="text-theme-text-muted block text-xs">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
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
            tooltip="Configure your department's name, logo, timezone and modules from this page. Member settings and the rank ladder moved to Members Administration."
          />
        }
      >
        {renderContent()}
        <MovedToMembersAdmin />
      </SettingsLayout>
    </div>
  );
};

export default SettingsPage;
