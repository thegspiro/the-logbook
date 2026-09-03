import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router';
import {
  Home,
  Users,
  UserPlus,
  Calendar,
  FileText,
  Settings,
  LogOut,
  ChevronRight,
  ChevronDown,
  Shield,
  Building2,
  Camera,
  UserCog,
  Globe,
  GraduationCap,
  Package,
  Clock,
  Truck,
  Vote,
  ClipboardList,
  BookOpen,
  Layers,
  AlertTriangle,
  BarChart3,
  Bell,
  FormInput,
  Mail,
  Megaphone,
  Plug,
  MapPin,
  Network,
  Rocket,
  ShieldCheck,
  ClipboardCheck,
  Activity,
  CreditCard,
  ScanLine,
  Nfc,
  Scale,
  Stethoscope,
  Store,
} from 'lucide-react';
import { Sun, Moon, Monitor, Contrast, WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthStore } from '../../stores/authStore';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { useConnectedIntegrations } from '../../hooks/useConnectedIntegrations';
import { NFC_ID_CARDS_INTEGRATION } from '../../modules/membership/constants/idCards';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';
import { canOpenAdministrationSection } from './adminNavigation';
import { LEGAL_DOCUMENTS_PERMISSIONS } from '../../modules/governance';
import { FACILITY_ENTRY_PERMISSIONS } from '../../modules/facilities/routes';
import { prefetchRoute } from '../../utils/routePrefetch';
import { useNotificationCountStore } from '../../hooks/useNotificationCount';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { usePendingSyncStore } from '../../stores/pendingSyncStore';
import { triggerOfflineDrain } from '../../hooks/useOfflineSyncEngine';

interface SideNavigationProps {
  departmentName: string;
  logoPreview: string | null;
  onLogout: () => void;
}

interface SubNavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  permission?: string;
  /** Any one of these permissions grants access (OR logic). */
  anyPermission?: string[];
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  permission?: string;
  /** Any one of these permissions grants access (OR logic). */
  anyPermission?: string[];
  subItems?: SubNavItem[];
  /** If true, this item is a visual section divider label */
  isSectionLabel?: boolean;
}

export const SideNavigation: React.FC<SideNavigationProps> = ({ departmentName, logoPreview, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { user: currentUser, checkPermission } = useAuthStore();
  const notifUnreadCount = useNotificationCountStore((s) => s.unreadCount);
  const isOnline = useOnlineStatus();
  const pendingSyncCount = usePendingSyncStore((s) => s.count);
  const pendingSyncStatus = usePendingSyncStore((s) => s.status);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['Settings']);
  const sideNavRef = useFocusTrap<HTMLElement>(mobileMenuOpen);
  const { isModuleOn } = useEnabledModules();
  const { isConnected } = useConnectedIntegrations();
  const isNfcCardsOn = isConnected(NFC_ID_CARDS_INTEGRATION);

  // The mobile bottom bar's "More" button asks us to open the drawer.
  useEffect(() => {
    const open = () => setMobileMenuOpen(true);
    window.addEventListener(OPEN_MOBILE_NAV_EVENT, open);
    return () => window.removeEventListener(OPEN_MOBILE_NAV_EVENT, open);
  }, []);

  // Lock body scroll while the mobile drawer is open. `overscroll-contain` on
  // the drawer only stops scroll *chaining* once the drawer itself scrolls; it
  // does nothing for touches that begin on the backdrop, which would otherwise
  // scroll the page behind the menu. Mirrors the lock in Modal.tsx.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileMenuOpen]);

  // Auto-expand parent menu when navigating to a child route
  useEffect(() => {
    setExpandedMenus((prev) => {
      const activeParent = navItems.find((item) =>
        item.subItems?.some((sub) => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/'))
      );
      if (activeParent && !prev.includes(activeParent.label)) {
        return [...prev, activeParent.label];
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const cycleTheme = () => {
    const order = ['light', 'dark', 'system', 'high-contrast'] as const;
    const currentIndex = order.indexOf(theme);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex] ?? 'system');
  };

  // Quick toggle for high-contrast mode — one tap, restorable.
  const toggleHighContrast = () => {
    if (theme === 'high-contrast') {
      const previous = (localStorage.getItem('preHighContrastTheme') as 'light' | 'dark' | 'system' | null) || 'system';
      setTheme(previous);
    } else {
      localStorage.setItem('preHighContrastTheme', theme);
      setTheme('high-contrast');
    }
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : theme === 'high-contrast' ? Contrast : Monitor;
  const themeLabel =
    theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : theme === 'high-contrast' ? 'High Contrast' : 'System';

  // Determine if user has any admin permission (to show/hide the
  // Administration section). The shared helper's list mirrors the
  // section items' gates — extend it there, never inline, so Side/Top
  // navigation cannot drift apart.
  const hasAnyAdminPermission = canOpenAdministrationSection(checkPermission);
  const canReviewLegalDocuments = LEGAL_DOCUMENTS_PERMISSIONS.some((p) => checkPermission(p));

  const navItems: NavItem[] = [
    // ── Member-facing pages ──
    { label: 'Dashboard', path: '/dashboard', icon: Home },
    { label: 'Learning Center', path: '/learning', icon: BookOpen },
    { label: 'Members', path: '/members', icon: Users },
    { label: 'Events', path: '/events', icon: Calendar },
    { label: 'Documents', path: '/documents', icon: FileText },
    // The route requires `storefront.view` (modules/storefront/routes.tsx), so
    // the module toggle alone is not the gate: a member whose department was
    // seeded before the storefront module shipped holds no storefront grant
    // and got Access Denied from an entry the navigation was still
    // advertising. A nav gate has to be a subset of its route's gate.
    ...(isModuleOn('storefront')
      ? [{ label: 'Department Store', path: '/store', icon: Store, permission: 'storefront.view' } as NavItem]
      : []),
    ...(isModuleOn('training')
      ? [
          {
            label: 'Training',
            path: '#',
            icon: GraduationCap,
            subItems: [
              {
                label: 'My Training',
                path: '/training/my-training',
                icon: GraduationCap,
              },
              {
                label: 'Submit Training',
                path: '/training/submit',
                icon: ClipboardList,
              },
              {
                label: 'Course Library',
                path: '/training/courses',
                icon: BookOpen,
              },
              { label: 'Programs', path: '/training/programs', icon: Layers },
              {
                label: 'Skills Testing',
                path: '/training/skills-testing',
                icon: ClipboardCheck,
              },
            ],
          } as NavItem,
        ]
      : []),
    {
      label: 'Admin Hours',
      path: '/admin-hours',
      icon: ClipboardCheck,
    },
    ...(isModuleOn('scheduling')
      ? [
          {
            label: 'Shift Scheduling',
            path: '/scheduling',
            icon: Clock,
          } as NavItem,
        ]
      : []),
    {
      label: 'Operations',
      path: '#',
      icon: Package,
      subItems: [
        // My Issued Gear carries no gate: it is a member's own kit, plus the
        // request and return they raise against it. Inventory is the
        // whole department's catalogue and gates on `inventory.manage` —
        // NOT on `inventory.view`, which every seeded member holds and needs
        // for the request picker's item search.
        ...(isModuleOn('inventory')
          ? [
              {
                label: 'My Issued Gear',
                path: '/inventory/my-equipment',
                icon: Package,
              },
              { label: 'Inventory', path: '/inventory', icon: Package, permission: 'inventory.manage' },
            ]
          : []),
        // Its own entry rather than a child of Inventory: the two are
        // run by different officers in departments that split the role, and
        // burying one under the other implies a hierarchy that isn't there.
        //
        // Deliberately NOT gated on the broad `inventory.view`, which both
        // rank-and-file seeded roles hold: this is the stock room, and the
        // people with a task on it are the ones who keep it stocked. A member
        // restocking a rig from what they used wants Apparatus Inventory
        // below, not this. The route and the API stay open on `inventory.view`
        // — a member who follows a link can still look — but an entry every
        // member carries in their nav implies a job they do not have.
        //
        // `view_medical` alone, and not the manage grants beside it: the route
        // accepts only MEDICAL_VIEW_PERMISSIONS, and `checkPermission` gives
        // no manage-implies-view. Advertising `manage_medical` here would send
        // a supply officer who holds it without the read grant straight to
        // Access Denied. A nav gate has to be a subset of its route's gate.
        // Every seeded role that stocks medical holds `view_medical`.
        ...(isModuleOn('medical_supplies')
          ? [
              {
                label: 'Medical Supplies',
                path: '/medical-supplies',
                icon: Stethoscope,
                permission: 'inventory.view_medical',
              },
            ]
          : []),
        // Equipment checklists. Two rows, because the two audiences want
        // different things and one of them is everybody: a member wants the
        // checks they owe, an officer wants the state of the fleet.
        //
        // "My Checklists" carries no permission gate on purpose. Walking a
        // truck is the one thing every member does, the API narrows
        // /my-checklists to the caller, and this row is now their only route
        // to it — the Scheduling tab that used to carry them here is gone, and
        // until it was added nothing in the nav pointed at checklists at all.
        ...(isModuleOn('inventory')
          ? [
              {
                label: 'My Checklists',
                path: '/inventory/checklists/my',
                icon: ClipboardCheck,
              },
              {
                label: 'Fleet Readiness',
                path: '/inventory/checklists',
                // Not ClipboardCheck, which "My Checklists" directly above
                // already uses. The rail collapses to a 20-unit icon-only
                // strip where the label is replaced by a hover title, so two
                // adjacent rows sharing a glyph are indistinguishable at a
                // glance — and these two are for different audiences: the
                // checks you owe versus the state of the fleet.
                icon: ShieldCheck,
                anyPermission: ['inventory.check_view', 'scheduling.manage'],
              },
            ]
          : []),
        // The crew half of the same shelf: "we just used two of these",
        // recorded without starting a whole checklist. Gated on the default
        // member grant, matching the route's own gate — this is the medical
        // page most members actually need, and until now nothing in the nav
        // pointed at it.
        ...(isModuleOn('inventory')
          ? [
              {
                label: 'Apparatus Inventory',
                path: '/inventory/checklists/apparatus-inventory',
                icon: Truck,
                anyPermission: ['inventory.check_submit', 'inventory.check_view', 'inventory.view'],
              },
            ]
          : []),
        // Full apparatus module or lightweight version
        ...(isModuleOn('apparatus')
          ? [{ label: 'Apparatus', path: '/apparatus', icon: Truck }]
          : [{ label: 'Apparatus', path: '/apparatus-basic', icon: Truck }]),
        ...(isModuleOn('facilities')
          ? [
              {
                label: 'Facilities',
                path: '/facilities',
                icon: Building2,
                anyPermission: [...FACILITY_ENTRY_PERMISSIONS],
              },
            ]
          : []),
      ],
    },
    // When Facilities module is off, show a lightweight Locations page
    ...(isModuleOn('facilities') ? [] : [{ label: 'Locations', path: '/locations', icon: MapPin } as NavItem]),
    // Neither the org chart nor Legal Documents is behind a module flag: every
    // deployment publishes /privacy and /terms, and the org chart is the one
    // governance screen written for the general membership, so the group is
    // unconditional rather than following elections or minutes.
    {
      label: 'Governance',
      path: '/governance/org-chart',
      icon: Vote,
      subItems: [
        { label: 'Org Chart', path: '/governance/org-chart', icon: Network },
        ...(isModuleOn('elections') ? [{ label: 'Elections', path: '/elections', icon: Vote }] : []),
        ...(isModuleOn('minutes')
          ? [
              {
                label: 'Minutes',
                path: '/minutes',
                icon: ClipboardList,
              },
              {
                label: 'Action Items',
                path: '/action-items',
                icon: AlertTriangle,
              },
            ]
          : []),
        ...(canReviewLegalDocuments
          ? [
              {
                label: 'Legal Documents',
                path: '/governance/legal',
                icon: Scale,
              },
            ]
          : []),
      ],
    },
    ...(isModuleOn('notifications')
      ? [{ label: 'Notifications', path: '/notifications?tab=inbox', icon: Bell } as NavItem]
      : []),
    { label: 'Messages', path: '/messages', icon: Megaphone },

    // ── Personal settings (always visible) ──
    { label: 'My Account', path: '/account', icon: UserCog },
    ...(currentUser?.id
      ? [
          {
            label: 'My ID Card',
            path: `/members/${currentUser.id}/id-card`,
            icon: CreditCard,
          } as NavItem,
        ]
      : []),

    // ── Administration section (only shown to users with admin perms) ──
    ...(hasAnyAdminPermission
      ? [
          {
            label: 'Administration',
            path: '#',
            icon: Shield,
            isSectionLabel: true,
          } as NavItem,
          {
            label: 'Department Setup',
            path: '/setup',
            icon: Rocket,
            permission: 'settings.manage',
          } as NavItem,
          {
            label: 'Members',
            path: '#',
            icon: Users,
            // users.view holders (e.g. the quartermaster) get this group for
            // the ID scanner; the manage-only entries below stay gated.
            anyPermission: ['users.view', 'members.manage'],
            subItems: [
              ...(isModuleOn('prospective_members')
                ? [
                    {
                      label: 'Prospective',
                      path: '/prospective-members',
                      icon: UserPlus,
                      permission: 'prospective_members.manage',
                    },
                    {
                      label: 'Pipeline Settings',
                      path: '/prospective-members/settings',
                      icon: Settings,
                      permission: 'prospective_members.manage',
                    },
                  ]
                : []),
              {
                label: 'Member Management',
                path: '/members/admin',
                icon: UserCog,
                permission: 'members.manage',
              },
              {
                label: 'Scan Member ID',
                path: '/members/scan',
                icon: ScanLine,
                // Scanning resolves a card to a member profile, which the
                // backend serves to users.view or members.manage holders.
                anyPermission: ['users.view', 'members.manage'],
              },
              // Only where the department actually issues cards. The route
              // and the endpoints behind it refuse independently; this keeps a
              // dead entry out of the menu for everyone else.
              ...(isNfcCardsOn
                ? [
                    {
                      label: 'Check-In Station',
                      path: '/members/check-in-station',
                      icon: Nfc,
                      permission: 'members.check_in',
                    },
                  ]
                : []),
              {
                label: 'Waivers',
                path: '/members/admin/waivers',
                icon: ShieldCheck,
                permission: 'members.manage',
              },
              ...(isModuleOn('medical_screening')
                ? [
                    {
                      label: 'Medical Screening',
                      path: '/medical-screening',
                      icon: Stethoscope,
                      permission: 'medical_screening.view',
                    },
                  ]
                : []),
            ],
          } as NavItem,
          {
            label: 'Manage Events',
            path: '/events',
            icon: Calendar,
            permission: 'events.manage',
          } as NavItem,
          ...(isModuleOn('training')
            ? [
                {
                  label: 'Training Admin',
                  path: '/training/admin',
                  icon: GraduationCap,
                  permission: 'training.manage',
                } as NavItem,
              ]
            : []),
          ...(isModuleOn('inventory') || isModuleOn('storefront')
            ? [
                {
                  label: 'Inventory Administration',
                  path: '/inventory/admin',
                  icon: Package,
                  anyPermission: ['inventory.manage', 'inventory.check_manage', 'storefront.manage'],
                } as NavItem,
              ]
            : []),
          {
            label: 'Admin Hours',
            path: '/admin-hours/manage',
            icon: ClipboardCheck,
            permission: 'admin_hours.manage',
          } as NavItem,
          {
            label: 'Forms & Comms',
            path: '#',
            icon: FormInput,
            subItems: [
              {
                label: 'Email Templates',
                path: '/communications/email-templates',
                icon: Mail,
                permission: 'settings.manage',
              },
              {
                label: 'Messages',
                path: '/communications/messages',
                icon: Megaphone,
                permission: 'notifications.manage',
              },
              {
                label: 'Photo Use Consent',
                path: '/communications/photo-use-consent',
                icon: Camera,
                anyPermission: ['users.view_consents', 'notifications.manage', 'members.manage', 'users.edit'],
              },
              ...(isModuleOn('forms')
                ? [{ label: 'Forms', path: '/forms', icon: FormInput, permission: 'forms.manage' }]
                : []),
              ...(isModuleOn('integrations')
                ? [
                    {
                      label: 'Integrations',
                      path: '/integrations',
                      icon: Plug,
                      permission: 'settings.manage',
                    },
                  ]
                : []),
            ],
          } as NavItem,
          ...(isModuleOn('reports')
            ? [
                {
                  label: 'Reports',
                  path: '/reports',
                  icon: BarChart3,
                  permission: 'reports.view',
                } as NavItem,
              ]
            : []),
          {
            label: 'Organization Settings',
            path: '/settings',
            icon: Settings,
            permission: 'settings.manage',
            subItems: [
              { label: 'Organization', path: '/settings', icon: Building2 },
              {
                label: 'Role Management',
                path: '/settings/roles',
                icon: Shield,
                permission: 'positions.manage_permissions',
              },
              ...(isModuleOn('public_info')
                ? [
                    {
                      label: 'Public Portal',
                      path: '/admin/public-portal',
                      icon: Globe,
                      permission: 'settings.manage',
                    },
                  ]
                : []),
              {
                label: 'Platform Analytics',
                path: '/admin/platform-analytics',
                icon: Activity,
                permission: 'settings.manage',
              },
              {
                label: 'QR Code Analytics',
                path: '/admin/analytics',
                icon: BarChart3,
                permission: 'analytics.view',
              },
              {
                label: 'Audit Log',
                path: '/admin/audit-log',
                icon: ShieldCheck,
                permission: 'audit.view',
              },
              {
                label: 'Error Monitor',
                path: '/admin/errors',
                icon: AlertTriangle,
                permission: 'settings.manage',
              },
              ...(isModuleOn('testing')
                ? [
                    {
                      label: 'Testing Home',
                      path: '/testing',
                      icon: ClipboardCheck,
                      permission: 'settings.manage',
                    },
                  ]
                : []),
            ],
          } as NavItem,
        ]
      : []),
  ];

  const isActive = (path: string) => {
    if (path === '#') return false;
    const pathOnly = path.split('?')[0] ?? path;
    return location.pathname === pathOnly || location.pathname.startsWith(pathOnly + '/');
  };

  const isSubItemActive = (path: string, siblings: { path: string }[]) => {
    if (path === '#') return false;
    if (location.pathname === path) return true;
    if (!location.pathname.startsWith(path + '/')) return false;
    // Don't prefix-match if a sibling is a more specific match
    return !siblings.some(
      (s) =>
        s.path !== path &&
        s.path.length > path.length &&
        (location.pathname === s.path || location.pathname.startsWith(s.path + '/'))
    );
  };

  const isParentActive = (item: NavItem) => {
    if (item.subItems) {
      return item.subItems.some((sub) => isActive(sub.path));
    }
    return isActive(item.path);
  };

  const toggleMenu = (label: string) => {
    setExpandedMenus((prev) => (prev.includes(label) ? prev.filter((m) => m !== label) : [...prev, label]));
  };

  const handleNavigation = (path: string, hasSubItems?: boolean, label?: string) => {
    if (hasSubItems && !collapsed) {
      if (label) toggleMenu(label);
      return;
    }
    if (path !== '#') {
      void navigate(path);
      setMobileMenuOpen(false);
    }
  };

  const activeDestination = navItems
    .flatMap((item) => (item.subItems?.length ? item.subItems : [item]))
    .filter((item) => isActive(item.path))
    .sort((a, b) => b.path.length - a.path.length)[0];

  return (
    <>
      {/* Mobile Header */}
      <header
        className="bg-theme-nav-bg border-theme-surface-border safe-top fixed top-0 right-0 left-0 z-50 border-b md:hidden"
        role="banner"
      >
        <div className="flex h-16 items-center px-4">
          <Link
            to="/dashboard"
            className="focus:ring-theme-focus-ring flex min-h-[44px] min-w-0 flex-1 items-center rounded-lg focus:ring-2 focus:outline-hidden"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
              <img
                src={logoPreview || '/logo-128.png'}
                alt={`${departmentName} logo`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="ml-3 min-w-0 flex-1">
              <span className="text-theme-text-primary block truncate text-base leading-tight font-semibold sm:text-lg">
                {departmentName}
              </span>
            </div>
          </Link>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="mobile-header-inset fixed right-0 bottom-0 left-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Side Navigation */}
      <aside
        ref={sideNavRef}
        id="side-navigation"
        role="navigation"
        aria-label="Main navigation"
        className={`mobile-navigation-drawer safe-top bg-theme-nav-bg border-theme-surface-border fixed left-0 z-40 overscroll-contain border-r transition-all duration-300 md:top-0 md:h-full ${
          collapsed ? 'w-20' : 'w-64'
        } ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
        <div className="flex h-full flex-col">
          {/* Logo Section */}
          <div className="border-theme-surface-border hidden border-b p-4 md:block">
            {collapsed ? (
              <>
                <div className="flex items-center justify-center">
                  <Link
                    to="/dashboard"
                    className="focus:ring-theme-focus-ring flex min-h-[44px] items-center overflow-hidden rounded-lg focus:ring-2 focus:outline-hidden"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                      <img
                        src={logoPreview || '/logo-128.png'}
                        alt={`${departmentName} logo`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  </Link>
                </div>
                <button
                  onClick={() => setCollapsed(false)}
                  className="text-theme-text-secondary hover:text-theme-text-primary focus:ring-theme-focus-ring mt-2 hidden w-full rounded-sm p-2 transition-colors focus:ring-2 focus:outline-hidden md:block"
                  aria-label="Expand navigation"
                >
                  <ChevronRight className="mx-auto h-5 w-5" aria-hidden="true" />
                </button>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <Link
                  to="/dashboard"
                  className="focus:ring-theme-focus-ring flex min-h-[44px] items-center overflow-hidden rounded-lg focus:ring-2 focus:outline-hidden"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                    <img
                      src={logoPreview || '/logo-128.png'}
                      alt={`${departmentName} logo`}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="ml-3 min-w-0">
                    <span className="text-theme-text-primary block text-sm leading-tight font-semibold wrap-break-word">
                      {departmentName}
                    </span>
                    <p className="text-theme-text-muted text-xs">Dashboard</p>
                  </div>
                </Link>
                <button
                  onClick={() => setCollapsed(true)}
                  className="text-theme-text-secondary hover:text-theme-text-primary focus:ring-theme-focus-ring flex hidden min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-sm p-2 transition-colors focus:ring-2 focus:outline-hidden md:block"
                  aria-label="Collapse navigation"
                >
                  <ChevronRight className="h-5 w-5 rotate-180" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {/* Navigation Items */}
          <nav
            className="-webkit-overflow-scrolling-touch flex-1 space-y-1 overflow-y-auto overscroll-contain p-4"
            aria-label="Side navigation"
          >
            {mobileMenuOpen && activeDestination && (
              <div className="bg-theme-surface-hover text-theme-text-primary mb-3 rounded-lg px-4 py-3 md:hidden">
                <span className="text-theme-text-muted block text-[10px] font-bold tracking-widest uppercase">
                  Current
                </span>
                <span className="text-sm font-semibold">{activeDestination.label}</span>
              </div>
            )}
            <ul role="list" className="space-y-1">
              {navItems.map((item, idx) => {
                // Render section label dividers
                if (item.isSectionLabel) {
                  return (
                    <li key={`section-${item.label}`} aria-hidden="true">
                      {!collapsed ? (
                        <div className="px-4 pt-3 pb-2 md:pt-5">
                          <div className="border-theme-surface-border border-t" />
                          <span className="text-theme-text-muted/70 mt-3 block text-[10px] font-bold tracking-widest uppercase">
                            {item.label}
                          </span>
                        </div>
                      ) : (
                        <div className="px-3 pt-3 pb-1">
                          <div className="border-theme-surface-border border-t" />
                        </div>
                      )}
                    </li>
                  );
                }

                // Filter sub-items by permission
                const visibleSubItems = item.subItems?.filter(
                  (sub) =>
                    (!sub.permission || checkPermission(sub.permission)) &&
                    (!sub.anyPermission || sub.anyPermission.some((p) => checkPermission(p)))
                );

                // Skip top-level permission-gated items
                if (item.permission && !checkPermission(item.permission)) return null;
                if (item.anyPermission && !item.anyPermission.some((p) => checkPermission(p))) return null;

                // Skip parent groups where all sub-items are hidden
                if (item.subItems && visibleSubItems && visibleSubItems.length === 0) return null;

                const Icon = item.icon;
                const hasSubItems = !!visibleSubItems && visibleSubItems.length > 0;
                const isExpanded = expandedMenus.includes(item.label);
                const parentActive = isParentActive(item);

                // Use unique key that accounts for duplicate labels across sections
                const itemKey = `${item.label}-${item.path}-${idx}`;

                return (
                  <li key={itemKey}>
                    <button
                      onClick={() => handleNavigation(item.path, hasSubItems, item.label)}
                      onMouseEnter={() => {
                        if (item.path !== '#') prefetchRoute(item.path);
                        // Also prefetch sub-item routes on parent hover
                        visibleSubItems?.forEach((sub) => prefetchRoute(sub.path));
                      }}
                      onFocus={() => {
                        if (item.path !== '#') prefetchRoute(item.path);
                      }}
                      aria-current={parentActive && !hasSubItems ? 'page' : undefined}
                      aria-expanded={hasSubItems ? isExpanded : undefined}
                      aria-controls={hasSubItems ? `submenu-${item.label}` : undefined}
                      className={`focus:ring-theme-focus-ring flex w-full items-center rounded-lg transition-all duration-150 focus:ring-2 focus:outline-hidden ${
                        collapsed ? 'justify-center p-3' : 'px-4 py-3'
                      } ${
                        parentActive && !hasSubItems
                          ? 'bg-red-800 text-white shadow-sm'
                          : parentActive && hasSubItems
                            ? 'bg-theme-surface-secondary text-theme-text-primary'
                            : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary active:scale-[0.98]'
                      }`}
                      title={collapsed ? item.label : undefined}
                      aria-label={
                        collapsed
                          ? item.label === 'Notifications' && notifUnreadCount > 0
                            ? `Notifications (${notifUnreadCount} unread)`
                            : item.label
                          : undefined
                      }
                    >
                      <span className="relative">
                        <Icon className={`h-5 w-5 shrink-0 ${collapsed ? '' : 'mr-3'}`} aria-hidden="true" />
                        {collapsed && item.label === 'Notifications' && notifUnreadCount > 0 && (
                          <span className="border-theme-nav-bg absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 bg-red-500" />
                        )}
                      </span>
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left text-sm font-medium">{item.label}</span>
                          {item.label === 'Notifications' && notifUnreadCount > 0 && !parentActive && (
                            <span className="mr-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                              {notifUnreadCount > 99 ? '99+' : notifUnreadCount}
                            </span>
                          )}
                          {hasSubItems && (
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              aria-hidden="true"
                            />
                          )}
                        </>
                      )}
                    </button>

                    {/* Sub Items */}
                    {hasSubItems && isExpanded && !collapsed && (
                      <ul id={`submenu-${item.label}`} className="mt-1 ml-4 space-y-1" role="list">
                        {visibleSubItems.map((subItem) => {
                          const SubIcon = subItem.icon;
                          const subActive = isSubItemActive(subItem.path, item.subItems || []);
                          return (
                            <li key={subItem.path}>
                              <button
                                onClick={() => handleNavigation(subItem.path)}
                                onMouseEnter={() => prefetchRoute(subItem.path)}
                                onFocus={() => prefetchRoute(subItem.path)}
                                aria-current={subActive ? 'page' : undefined}
                                className={`focus:ring-theme-focus-ring flex w-full items-center rounded-lg px-4 py-2 transition-all duration-150 focus:ring-2 focus:outline-hidden max-md:min-h-[44px] ${
                                  subActive
                                    ? 'bg-red-800 text-white shadow-sm'
                                    : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary active:scale-[0.98]'
                                }`}
                              >
                                <SubIcon className="mr-3 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span className="text-sm">{subItem.label}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Theme Toggle & Logout */}
          <div className="border-theme-surface-border space-y-1 border-t p-4">
            {!isOnline && (
              <div
                className={`flex items-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 ${
                  collapsed ? 'justify-center p-2' : 'px-3 py-2'
                }`}
                role="status"
                aria-live="polite"
                title={
                  pendingSyncCount > 0
                    ? `Offline · ${pendingSyncCount} pending. Will sync when reconnected.`
                    : 'You are offline. Submissions will queue and sync when reconnected.'
                }
              >
                <WifiOff className={`h-4 w-4 shrink-0 ${collapsed ? '' : 'mr-2'}`} aria-hidden="true" />
                {!collapsed && (
                  <span className="text-xs font-medium">
                    {pendingSyncCount > 0
                      ? `Offline · ${pendingSyncCount} pending`
                      : 'Offline — will sync when reconnected'}
                  </span>
                )}
              </div>
            )}
            {isOnline && pendingSyncCount > 0 && (
              <button
                onClick={() => {
                  void triggerOfflineDrain();
                }}
                className={`focus:ring-theme-focus-ring flex w-full items-center rounded-lg bg-blue-500/15 text-blue-700 transition-colors hover:bg-blue-500/25 focus:ring-2 focus:outline-hidden max-md:min-h-[44px] dark:text-blue-300 ${
                  collapsed ? 'justify-center p-2' : 'px-3 py-2'
                }`}
                title={collapsed ? `${pendingSyncCount} pending sync — click to retry` : undefined}
                aria-label={`${pendingSyncCount} pending sync. Click to retry now.`}
              >
                {pendingSyncStatus === 'syncing' ? (
                  <Loader2 className={`h-4 w-4 shrink-0 animate-spin ${collapsed ? '' : 'mr-2'}`} aria-hidden="true" />
                ) : (
                  <RefreshCw className={`h-4 w-4 shrink-0 ${collapsed ? '' : 'mr-2'}`} aria-hidden="true" />
                )}
                {!collapsed && <span className="text-xs font-medium">{pendingSyncCount} pending sync — retry</span>}
              </button>
            )}
            <button
              onClick={cycleTheme}
              className={`text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary focus:ring-theme-focus-ring flex w-full items-center rounded-lg transition-all focus:ring-2 focus:outline-hidden ${
                collapsed ? 'justify-center p-3' : 'px-4 py-3'
              }`}
              title={collapsed ? `Theme: ${themeLabel}` : undefined}
              aria-label={`Current theme: ${themeLabel}. Click to cycle theme.`}
            >
              <ThemeIcon className={`h-5 w-5 shrink-0 ${collapsed ? '' : 'mr-3'}`} aria-hidden="true" />
              {!collapsed && <span className="text-sm font-medium">Theme: {themeLabel}</span>}
            </button>
            <button
              onClick={toggleHighContrast}
              aria-pressed={theme === 'high-contrast'}
              className={`focus:ring-theme-focus-ring flex w-full items-center rounded-lg transition-all focus:ring-2 focus:outline-hidden ${
                theme === 'high-contrast'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
              } ${collapsed ? 'justify-center p-3' : 'px-4 py-3'}`}
              title={
                collapsed
                  ? theme === 'high-contrast'
                    ? 'High contrast on — click to restore'
                    : 'Turn on high contrast'
                  : undefined
              }
              aria-label={
                theme === 'high-contrast'
                  ? 'High contrast on — click to restore previous theme'
                  : 'Turn on high contrast'
              }
            >
              <Contrast className={`h-5 w-5 shrink-0 ${collapsed ? '' : 'mr-3'}`} aria-hidden="true" />
              {!collapsed && (
                <span className="text-sm font-medium">
                  {theme === 'high-contrast' ? 'High contrast on' : 'High contrast'}
                </span>
              )}
            </button>
            <button
              onClick={onLogout}
              className={`text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary focus:ring-theme-focus-ring flex w-full items-center rounded-lg transition-all focus:ring-2 focus:outline-hidden ${
                collapsed ? 'justify-center p-3' : 'px-4 py-3'
              }`}
              title={collapsed ? 'Logout' : undefined}
              aria-label={collapsed ? 'Logout' : undefined}
            >
              <LogOut className={`h-5 w-5 shrink-0 ${collapsed ? '' : 'mr-3'}`} aria-hidden="true" />
              {!collapsed && <span className="text-sm font-medium">Logout</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
