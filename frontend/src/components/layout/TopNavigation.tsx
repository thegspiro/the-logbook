import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  Contrast,
  ChevronDown,
  Bell,
  UserCog,
  WifiOff,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthStore } from '../../stores/authStore';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';
import { useNotificationCountStore } from '../../hooks/useNotificationCount';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { usePendingSyncStore } from '../../stores/pendingSyncStore';
import { triggerOfflineDrain } from '../../hooks/useOfflineSyncEngine';

interface TopNavigationProps {
  departmentName: string;
  logoPreview: string | null;
  onLogout: () => void;
}

interface SubNavItem {
  label: string;
  path: string;
  permission?: string;
  isDivider?: boolean;
}

interface NavItem {
  label: string;
  path: string;
  permission?: string;
  subItems?: SubNavItem[];
  isSectionLabel?: boolean;
}

export const TopNavigation: React.FC<TopNavigationProps> = ({ departmentName, logoPreview, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { checkPermission } = useAuthStore();
  const notifUnreadCount = useNotificationCountStore((s) => s.unreadCount);
  const isOnline = useOnlineStatus();
  const pendingSyncCount = usePendingSyncStore((s) => s.count);
  const pendingSyncStatus = usePendingSyncStore((s) => s.status);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [expandedMobileMenus, setExpandedMobileMenus] = useState<string[]>([]);
  const mobileMenuRef = useFocusTrap<HTMLDivElement>(mobileMenuOpen);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { isModuleOn } = useEnabledModules();

  // The mobile bottom bar's "More" button asks us to open the menu.
  useEffect(() => {
    const open = () => setMobileMenuOpen(true);
    window.addEventListener(OPEN_MOBILE_NAV_EVENT, open);
    return () => window.removeEventListener(OPEN_MOBILE_NAV_EVENT, open);
  }, []);

  const cycleTheme = () => {
    const order = ['light', 'dark', 'system', 'high-contrast'] as const;
    const currentIndex = order.indexOf(theme);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex] ?? 'system');
  };

  // Quick toggle for high-contrast mode — older volunteers and night shifts need this
  // reachable without opening the theme menu. Remembers the previous theme for restore.
  const toggleHighContrast = () => {
    if (theme === 'high-contrast') {
      const previous = (localStorage.getItem('preHighContrastTheme') as 'light' | 'dark' | 'system' | null) || 'system';
      setTheme(previous);
    } else {
      localStorage.setItem('preHighContrastTheme', theme);
      setTheme('high-contrast');
    }
  };

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : theme === 'high-contrast' ? Contrast : Monitor;
  const themeLabel =
    theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : theme === 'high-contrast' ? 'High Contrast' : 'System';
  const ThemeIcon = themeIcon;

  const hasAnyAdminPermission =
    checkPermission('members.manage') ||
    checkPermission('prospective_members.manage') ||
    checkPermission('events.manage') ||
    checkPermission('training.manage') ||
    checkPermission('inventory.manage') ||
    checkPermission('admin_hours.manage') ||
    checkPermission('positions.manage_permissions') ||
    checkPermission('settings.manage') ||
    checkPermission('forms.view') ||
    checkPermission('analytics.view');

  // Build the divider sentinel used between Admin sub-groups
  const DIV: SubNavItem = { label: '', path: '', isDivider: true };

  // Match the side navigation structure
  const navItems: NavItem[] = [
    // ── Member-facing pages (logo links to Dashboard) ──
    { label: 'Members', path: '/members' },
    { label: 'Events', path: '/events' },
    { label: 'Documents', path: '/documents' },
    ...(isModuleOn('training')
      ? [
          {
            label: 'Training',
            path: '/training/my-training',
            subItems: [
              { label: 'My Training', path: '/training/my-training' },
              { label: 'Submit Training', path: '/training/submit' },
              { label: 'Course Library', path: '/training/courses' },
              { label: 'Programs', path: '/training/programs' },
              { label: 'Skills Testing', path: '/training/skills-testing' },
            ],
          } as NavItem,
        ]
      : []),
    { label: 'Admin Hours', path: '/admin-hours' },
    ...(isModuleOn('scheduling') ? [{ label: 'Shift Scheduling', path: '/scheduling' } as NavItem] : []),
    {
      label: 'Operations',
      path: '/inventory',
      subItems: [
        ...(isModuleOn('inventory')
          ? [
              { label: 'My Equipment', path: '/inventory/my-equipment' },
              { label: 'Inventory', path: '/inventory' },
            ]
          : []),
        ...(isModuleOn('storefront') ? [{ label: 'Department Store', path: '/store' }] : []),
        ...(isModuleOn('apparatus')
          ? [{ label: 'Apparatus', path: '/apparatus' }]
          : [{ label: 'Apparatus', path: '/apparatus-basic' }]),
        ...(isModuleOn('facilities') ? [{ label: 'Facilities', path: '/facilities' }] : []),
      ],
    },
    ...(isModuleOn('facilities') ? [] : [{ label: 'Locations', path: '/locations' } as NavItem]),
    ...(isModuleOn('elections') || isModuleOn('minutes')
      ? [
          {
            label: 'Governance',
            path: '/elections',
            subItems: [
              ...(isModuleOn('elections') ? [{ label: 'Elections', path: '/elections' }] : []),
              ...(isModuleOn('minutes')
                ? [
                    { label: 'Minutes', path: '/minutes' },
                    { label: 'Action Items', path: '/action-items' },
                  ]
                : []),
            ],
          } as NavItem,
        ]
      : []),

    // ── Administration (only for admins) ──
    ...(hasAnyAdminPermission
      ? [
          {
            label: 'Admin',
            path: '#',
            subItems: [
              { label: 'Department Setup', path: '/setup', permission: 'settings.manage' },
              DIV,
              ...(isModuleOn('prospective_members')
                ? [
                    {
                      label: 'Prospective Members',
                      path: '/prospective-members',
                      permission: 'prospective_members.manage',
                    },
                    {
                      label: 'Pipeline Settings',
                      path: '/prospective-members/settings',
                      permission: 'prospective_members.manage',
                    },
                  ]
                : []),
              { label: 'Member Management', path: '/members/admin', permission: 'members.manage' },
              { label: 'Scan Member ID', path: '/members/scan', permission: 'members.manage' },
              { label: 'Waivers', path: '/members/admin/waivers', permission: 'members.manage' },
              DIV,
              { label: 'Events Admin', path: '/events/admin', permission: 'events.manage' },
              ...(isModuleOn('training')
                ? [{ label: 'Training Admin', path: '/training/admin', permission: 'training.manage' }]
                : []),
              ...(isModuleOn('inventory')
                ? [{ label: 'Inventory Admin', path: '/inventory/admin', permission: 'inventory.manage' }]
                : []),
              ...(isModuleOn('storefront')
                ? [{ label: 'Store Admin', path: '/store/admin', permission: 'storefront.manage' }]
                : []),
              { label: 'Admin Hours', path: '/admin-hours/manage', permission: 'admin_hours.manage' },
              DIV,
              ...(isModuleOn('forms') ? [{ label: 'Forms', path: '/forms', permission: 'forms.view' }] : []),
              ...(isModuleOn('integrations')
                ? [{ label: 'Integrations', path: '/integrations', permission: 'settings.manage' }]
                : []),
              ...(isModuleOn('reports') ? [{ label: 'Reports', path: '/reports' }] : []),
              DIV,
              { label: 'Organization', path: '/settings', permission: 'settings.manage' },
              { label: 'Role Management', path: '/settings/roles', permission: 'positions.manage_permissions' },
              ...(isModuleOn('public_info')
                ? [{ label: 'Public Portal', path: '/admin/public-portal', permission: 'settings.manage' }]
                : []),
              { label: 'Platform Analytics', path: '/admin/platform-analytics', permission: 'settings.manage' },
              { label: 'QR Code Analytics', path: '/admin/analytics', permission: 'analytics.view' },
              { label: 'Audit Log', path: '/admin/audit-log', permission: 'audit.view' },
              { label: 'Error Monitor', path: '/admin/errors', permission: 'settings.manage' },
            ],
          } as NavItem,
        ]
      : []),
  ];

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isSubItemActive = (path: string, siblings: { path: string }[]) => {
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavigation = (path: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
    }
    if (path !== '#') {
      void navigate(path);
      setMobileMenuOpen(false);
      setOpenDropdown(null);
    }
  };

  const toggleMobileMenu = (label: string) => {
    setExpandedMobileMenus((prev) => (prev.includes(label) ? prev.filter((m) => m !== label) : [...prev, label]));
  };

  const notificationsActive = isActive('/notifications');
  const accountActive = isActive('/account');

  return (
    <header
      className="safe-top border-b"
      style={{ backgroundColor: 'var(--nav-bg)', borderColor: 'var(--nav-border)' }}
      role="banner"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo and Department Name */}
          <a
            href="/dashboard"
            className="focus:ring-theme-focus-ring flex min-h-[44px] items-center rounded-lg focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
          >
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg">
              <img
                src={logoPreview || '/logo-128.png'}
                alt={`${departmentName} logo`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="ml-3 min-w-0">
              <span className="text-theme-text-primary text-lg leading-tight font-semibold wrap-break-word">
                {departmentName}
              </span>
              <p className="text-theme-text-muted text-xs">Dashboard</p>
            </div>
          </a>

          {/* Desktop Navigation */}
          <nav className="hidden items-center space-x-1 md:flex" ref={dropdownRef} aria-label="Main navigation">
            {navItems.map((item) => {
              // Filter sub-items by permission (strip dividers whose neighbours are all hidden)
              const visibleSubItems = item.subItems?.filter(
                (sub) => sub.isDivider || !sub.permission || checkPermission(sub.permission)
              );

              // Strip leading, trailing, and consecutive dividers
              const cleanedSubItems = visibleSubItems?.filter((sub, i, arr) => {
                if (!sub.isDivider) return true;
                if (i === 0 || i === arr.length - 1) return false;
                return !arr[i - 1]?.isDivider;
              });

              // Skip top-level permission-gated items
              if (item.permission && !checkPermission(item.permission)) return null;

              // Skip parent groups where all sub-items are hidden
              const realSubItems = cleanedSubItems?.filter((s) => !s.isDivider);
              if (item.subItems && realSubItems && realSubItems.length === 0) return null;

              const hasSubItems = !!cleanedSubItems && cleanedSubItems.length > 0;
              const active = isParentActive(item);

              if (hasSubItems) {
                return (
                  <div key={item.label} className="relative">
                    <button
                      onClick={() => setOpenDropdown(openDropdown === item.label ? null : item.label)}
                      aria-expanded={openDropdown === item.label}
                      aria-haspopup="true"
                      className={`hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                        active ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                      }`}
                    >
                      {item.label}
                      <ChevronDown
                        className={`h-3 w-3 transition-transform ${openDropdown === item.label ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>

                    {openDropdown === item.label && (
                      <div
                        className={`bg-theme-surface-modal border-theme-surface-border animate-scale-in absolute top-full z-50 mt-1 rounded-lg border py-1 shadow-xl ${
                          item.label === 'Admin' ? 'right-0 w-56' : 'left-0 w-48'
                        }`}
                      >
                        {cleanedSubItems.map((subItem, idx) => {
                          if (subItem.isDivider) {
                            return (
                              <div
                                key={`div-${idx}`}
                                className="border-theme-surface-border my-1 border-t"
                                role="separator"
                              />
                            );
                          }
                          const subActive = isSubItemActive(
                            subItem.path,
                            (item.subItems || []).filter((s) => !s.isDivider)
                          );
                          return (
                            <a
                              key={subItem.path}
                              href={subItem.path}
                              onClick={(e) => handleNavigation(subItem.path, e)}
                              aria-current={subActive ? 'page' : undefined}
                              className={`focus:ring-theme-focus-ring block px-4 py-2 text-sm transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                                subActive
                                  ? 'bg-red-600 text-white'
                                  : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                              }`}
                            >
                              {subItem.label}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <a
                  key={item.label}
                  href={item.path}
                  onClick={(e) => handleNavigation(item.path, e)}
                  aria-current={active ? 'page' : undefined}
                  className={`hover:bg-theme-surface-hover focus:ring-theme-focus-ring rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                    active ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                  }`}
                >
                  {item.label}
                </a>
              );
            })}

            {/* ── Utility icons ── */}
            <div className="border-theme-surface-border ml-1 flex items-center space-x-1 border-l pl-2">
              {(!isOnline || pendingSyncCount > 0) &&
                (pendingSyncCount > 0 && isOnline ? (
                  <button
                    onClick={() => {
                      void triggerOfflineDrain();
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/15 px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
                    title="Click to retry syncing pending submissions"
                    aria-label={`${pendingSyncCount} pending sync. Click to retry.`}
                  >
                    {pendingSyncStatus === 'syncing' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{pendingSyncCount} pending sync</span>
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300"
                    role="status"
                    aria-live="polite"
                    title={
                      pendingSyncCount > 0
                        ? `Offline · ${pendingSyncCount} pending. Will sync when reconnected.`
                        : 'You are offline. Submissions will queue and sync when reconnected.'
                    }
                  >
                    <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{pendingSyncCount > 0 ? `Offline · ${pendingSyncCount} pending` : 'Offline'}</span>
                  </span>
                ))}
              <a
                href="/notifications?tab=inbox"
                onClick={(e) => handleNavigation('/notifications?tab=inbox', e)}
                className={`focus:ring-theme-focus-ring relative rounded-md p-2 transition-colors focus:ring-2 focus:outline-hidden ${
                  notificationsActive
                    ? 'text-theme-text-primary'
                    : 'text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
                title="Notifications"
                aria-label={notifUnreadCount > 0 ? `Notifications (${notifUnreadCount} unread)` : 'Notifications'}
                aria-current={notificationsActive ? 'page' : undefined}
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {notifUnreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {notifUnreadCount > 99 ? '99+' : notifUnreadCount}
                  </span>
                )}
              </a>
              <a
                href="/account"
                onClick={(e) => handleNavigation('/account', e)}
                className={`focus:ring-theme-focus-ring rounded-md p-2 transition-colors focus:ring-2 focus:outline-hidden ${
                  accountActive ? 'text-theme-text-primary' : 'text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
                title="My Account"
                aria-label="My Account"
                aria-current={accountActive ? 'page' : undefined}
              >
                <UserCog className="h-4 w-4" aria-hidden="true" />
              </a>
              <button
                onClick={cycleTheme}
                className="text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring rounded-md p-2 transition-colors focus:ring-2 focus:outline-hidden"
                title={`Theme: ${themeLabel}`}
                aria-label={`Current theme: ${themeLabel}. Click to cycle theme.`}
              >
                <ThemeIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                onClick={toggleHighContrast}
                aria-pressed={theme === 'high-contrast'}
                className={`hover:bg-theme-surface-hover focus:ring-theme-focus-ring rounded-md p-2 transition-colors focus:ring-2 focus:outline-hidden ${
                  theme === 'high-contrast' ? 'text-amber-600 dark:text-amber-400' : 'text-theme-text-secondary'
                }`}
                title={theme === 'high-contrast' ? 'High contrast on — click to restore' : 'Turn on high contrast'}
                aria-label={
                  theme === 'high-contrast'
                    ? 'High contrast on — click to restore previous theme'
                    : 'Turn on high contrast'
                }
              >
                <Contrast className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                onClick={onLogout}
                className="text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring rounded-md p-2 transition-colors focus:ring-2 focus:outline-hidden"
                title="Logout"
                aria-label="Logout"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-theme-text-primary hover:bg-theme-surface-hover focus:ring-theme-focus-ring rounded-md p-2.5 transition-colors focus:ring-2 focus:outline-hidden md:hidden"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
            aria-label={mobileMenuOpen ? 'Close main menu' : 'Open main menu'}
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Menu className="h-6 w-6" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav id="mobile-menu" className="pb-4 md:hidden" aria-label="Mobile navigation">
            <div ref={mobileMenuRef} className="flex flex-col space-y-1">
              {navItems.map((item) => {
                // Filter sub-items by permission
                const visibleSubItems = item.subItems?.filter(
                  (sub) => sub.isDivider || !sub.permission || checkPermission(sub.permission)
                );

                const cleanedSubItems = visibleSubItems?.filter((sub, i, arr) => {
                  if (!sub.isDivider) return true;
                  if (i === 0 || i === arr.length - 1) return false;
                  return !arr[i - 1]?.isDivider;
                });

                // Skip top-level permission-gated items
                if (item.permission && !checkPermission(item.permission)) return null;

                // Skip parent groups where all sub-items are hidden
                const realSubItems = cleanedSubItems?.filter((s) => !s.isDivider);
                if (item.subItems && realSubItems && realSubItems.length === 0) return null;

                const hasSubItems = !!cleanedSubItems && cleanedSubItems.length > 0;
                const isExpanded = expandedMobileMenus.includes(item.label);

                if (hasSubItems) {
                  return (
                    <div key={item.label}>
                      <button
                        onClick={() => toggleMobileMenu(item.label)}
                        aria-expanded={isExpanded}
                        className={`hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex min-h-[44px] w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                          isParentActive(item) ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                        }`}
                      >
                        {item.label}
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                      {isExpanded && (
                        <div className="mt-1 ml-4 space-y-1">
                          {cleanedSubItems.map((subItem, idx) => {
                            if (subItem.isDivider) {
                              return (
                                <div
                                  key={`div-${idx}`}
                                  className="border-theme-surface-border mx-3 my-1 border-t"
                                  role="separator"
                                />
                              );
                            }
                            const subActive = isSubItemActive(
                              subItem.path,
                              (item.subItems || []).filter((s) => !s.isDivider)
                            );
                            return (
                              <a
                                key={subItem.path}
                                href={subItem.path}
                                onClick={(e) => handleNavigation(subItem.path, e)}
                                aria-current={subActive ? 'page' : undefined}
                                className={`focus:ring-theme-focus-ring flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm transition-colors focus:ring-2 focus:outline-hidden ${
                                  subActive
                                    ? 'bg-red-600 text-white'
                                    : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                                }`}
                              >
                                {subItem.label}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <a
                    key={item.label}
                    href={item.path}
                    onClick={(e) => handleNavigation(item.path, e)}
                    aria-current={isActive(item.path) ? 'page' : undefined}
                    className={`hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                      isActive(item.path) ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}

              {/* ── Mobile utility links ── */}
              <div className="border-theme-surface-border mt-2 space-y-1 border-t pt-2">
                {!isOnline && (
                  <div
                    className="flex items-center space-x-2 rounded-md bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300"
                    role="status"
                    aria-live="polite"
                  >
                    <WifiOff className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {pendingSyncCount > 0
                        ? `Offline · ${pendingSyncCount} pending — will sync when reconnected`
                        : 'Offline — changes will sync when reconnected'}
                    </span>
                  </div>
                )}
                {isOnline && pendingSyncCount > 0 && (
                  <button
                    onClick={() => {
                      void triggerOfflineDrain();
                    }}
                    className="flex w-full items-center space-x-2 rounded-md bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-500/25 dark:text-blue-300"
                  >
                    {pendingSyncStatus === 'syncing' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{pendingSyncCount} pending sync — tap to retry</span>
                  </button>
                )}
                <a
                  href="/notifications?tab=inbox"
                  onClick={(e) => handleNavigation('/notifications?tab=inbox', e)}
                  aria-current={notificationsActive ? 'page' : undefined}
                  className={`hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                    notificationsActive ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                  }`}
                >
                  <Bell className="h-4 w-4" aria-hidden="true" />
                  <span>Notifications</span>
                  {notifUnreadCount > 0 && (
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {notifUnreadCount > 99 ? '99+' : notifUnreadCount}
                    </span>
                  )}
                </a>
                <a
                  href="/account"
                  onClick={(e) => handleNavigation('/account', e)}
                  aria-current={accountActive ? 'page' : undefined}
                  className={`hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                    accountActive ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                  }`}
                >
                  <UserCog className="h-4 w-4" aria-hidden="true" />
                  <span>My Account</span>
                </a>
                <button
                  onClick={cycleTheme}
                  className="text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden"
                >
                  <ThemeIcon className="h-4 w-4" aria-hidden="true" />
                  <span>Theme: {themeLabel}</span>
                </button>
                <button
                  onClick={toggleHighContrast}
                  aria-pressed={theme === 'high-contrast'}
                  className={`hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                    theme === 'high-contrast' ? 'text-amber-600 dark:text-amber-400' : 'text-theme-text-secondary'
                  }`}
                >
                  <Contrast className="h-4 w-4" aria-hidden="true" />
                  <span>{theme === 'high-contrast' ? 'High contrast on' : 'High contrast'}</span>
                </button>
                <button
                  onClick={onLogout}
                  className="text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
};
