import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, LogOut, Menu, X, Sun, Moon, Monitor, ChevronDown } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthStore } from '../../stores/authStore';
import { organizationService } from '../../services/api';

interface TopNavigationProps {
  departmentName: string;
  logoPreview: string | null;
  onLogout: () => void;
}

interface SubNavItem {
  label: string;
  path: string;
  permission?: string;
}

interface NavItem {
  label: string;
  path: string;
  permission?: string;
  subItems?: SubNavItem[];
  isSectionLabel?: boolean;
}

export const TopNavigation: React.FC<TopNavigationProps> = ({
  departmentName,
  logoPreview,
  onLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { checkPermission } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [expandedMobileMenus, setExpandedMobileMenus] = useState<string[]>([]);
  const mobileMenuRef = useFocusTrap<HTMLDivElement>(mobileMenuOpen);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [facilitiesModuleEnabled, setFacilitiesModuleEnabled] = useState(false);

  useEffect(() => {
    organizationService.getEnabledModules()
      .then(res => setFacilitiesModuleEnabled(res.enabled_modules.includes('facilities')))
      .catch(() => { /* default to false */ });
  }, []);

  const cycleTheme = () => {
    const order = ['light', 'dark', 'system'] as const;
    const currentIndex = order.indexOf(theme as typeof order[number]);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex]);
  };

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';
  const ThemeIcon = themeIcon;

  const hasAnyAdminPermission =
    checkPermission('members.manage') ||
    checkPermission('prospective_members.manage') ||
    checkPermission('events.manage') ||
    checkPermission('training.manage') ||
    checkPermission('inventory.manage') ||
    checkPermission('roles.manage') ||
    checkPermission('settings.manage') ||
    checkPermission('analytics.view');

  // Match the side navigation structure
  const navItems: NavItem[] = [
    // ── Member-facing pages ──
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Members', path: '/members' },
    { label: 'Events', path: '/events' },
    { label: 'Documents', path: '/documents' },
    {
      label: 'Training',
      path: '/training/my-training',
      subItems: [
        { label: 'My Training', path: '/training/my-training' },
        { label: 'Submit Training', path: '/training/submit' },
        { label: 'Course Library', path: '/training/courses' },
        { label: 'Programs', path: '/training/programs' },
      ],
    },
    { label: 'Scheduling', path: '/scheduling' },
    {
      label: 'Operations',
      path: '/inventory',
      subItems: [
        { label: 'Inventory', path: '/inventory' },
        { label: 'Apparatus', path: '/apparatus' },
        ...(facilitiesModuleEnabled ? [{ label: 'Facilities', path: '/facilities' }] : []),
      ],
    },
    ...(facilitiesModuleEnabled ? [] : [{ label: 'Locations', path: '/locations' } as NavItem]),
    {
      label: 'Governance',
      path: '/elections',
      subItems: [
        { label: 'Elections', path: '/elections' },
        { label: 'Minutes', path: '/minutes' },
      ],
    },
    { label: 'Notifications', path: '/notifications' },

    // ── Administration (only for admins) ──
    ...(hasAnyAdminPermission ? [{
      label: 'Admin',
      path: '#',
      subItems: [
        { label: 'Department Setup', path: '/setup', permission: 'settings.manage' },
        { label: 'Prospective Members', path: '/prospective-members', permission: 'prospective_members.manage' },
        { label: 'Pipeline Settings', path: '/prospective-members/settings', permission: 'prospective_members.manage' },
        { label: 'Member Management', path: '/members/admin', permission: 'members.manage' },
        { label: 'Events Admin', path: '/events/admin', permission: 'events.manage' },
        { label: 'Training Admin', path: '/training/admin', permission: 'training.manage' },
        { label: 'Inventory Admin', path: '/inventory/admin', permission: 'inventory.manage' },
        { label: 'Forms', path: '/forms', permission: 'settings.manage' },
        { label: 'Integrations', path: '/integrations', permission: 'settings.manage' },
        { label: 'Reports', path: '/reports' },
        { label: 'Organization', path: '/settings', permission: 'settings.manage' },
        { label: 'Role Management', path: '/settings/roles', permission: 'roles.manage' },
        { label: 'Public Portal', path: '/admin/public-portal', permission: 'settings.manage' },
        { label: 'Analytics', path: '/admin/analytics', permission: 'analytics.view' },
        { label: 'Error Monitor', path: '/admin/errors', permission: 'settings.manage' },
      ],
    } as NavItem] : []),

    // ── Always-visible personal ──
    { label: 'My Account', path: '/settings/account' },
  ];

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isSubItemActive = (path: string, siblings: { path: string }[]) => {
    if (location.pathname === path) return true;
    if (!location.pathname.startsWith(path + '/')) return false;
    // Don't prefix-match if a sibling is a more specific match
    return !siblings.some(s =>
      s.path !== path &&
      s.path.length > path.length &&
      (location.pathname === s.path || location.pathname.startsWith(s.path + '/'))
    );
  };

  const isParentActive = (item: NavItem) => {
    if (item.subItems) {
      return item.subItems.some(sub => isActive(sub.path));
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
      navigate(path);
      setMobileMenuOpen(false);
      setOpenDropdown(null);
    }
  };

  const toggleMobileMenu = (label: string) => {
    setExpandedMobileMenus(prev =>
      prev.includes(label) ? prev.filter(m => m !== label) : [...prev, label]
    );
  };

  return (
    <header className="border-b" style={{ backgroundColor: 'var(--nav-bg)', borderColor: 'var(--nav-border)' }} role="banner">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Department Name */}
          <a href="/dashboard" className="flex items-center focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded-lg">
            {logoPreview ? (
              <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
                <img
                  src={logoPreview}
                  alt=""
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : (
              <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center" aria-hidden="true">
                <Home className="w-6 h-6 text-white" />
              </div>
            )}
            <div className="ml-3 min-w-0">
              <span className="text-theme-text-primary text-lg font-semibold break-words leading-tight">{departmentName}</span>
              <p className="text-theme-text-muted text-xs">Dashboard</p>
            </div>
          </a>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1" ref={dropdownRef} aria-label="Main navigation">
            {navItems.map((item) => {
              // Filter sub-items by permission
              const visibleSubItems = item.subItems?.filter(
                (sub) => !sub.permission || checkPermission(sub.permission)
              );

              // Skip top-level permission-gated items
              if (item.permission && !checkPermission(item.permission)) return null;

              // Skip parent groups where all sub-items are hidden
              if (item.subItems && visibleSubItems && visibleSubItems.length === 0) return null;

              const hasSubItems = !!visibleSubItems && visibleSubItems.length > 0;
              const active = isParentActive(item);

              if (hasSubItems) {
                return (
                  <div key={item.label} className="relative">
                    <button
                      onClick={() => setOpenDropdown(openDropdown === item.label ? null : item.label)}
                      aria-expanded={openDropdown === item.label}
                      aria-haspopup="true"
                      className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 flex items-center gap-1 ${
                        active ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                      }`}
                    >
                      {item.label}
                      <ChevronDown className={`w-3 h-3 transition-transform ${openDropdown === item.label ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>

                    {openDropdown === item.label && (
                      <div className="absolute top-full left-0 mt-1 w-48 bg-theme-surface border border-theme-surface-border rounded-lg shadow-xl py-1 z-50">
                        {visibleSubItems.map((subItem) => {
                          const subActive = isSubItemActive(subItem.path, item.subItems || []);
                          return (
                          <a
                            key={subItem.path}
                            href={subItem.path}
                            onClick={(e) => handleNavigation(subItem.path, e)}
                            aria-current={subActive ? 'page' : undefined}
                            className={`block px-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500 ${
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
                  className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    active ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
            <button
              onClick={cycleTheme}
              className="text-theme-text-secondary p-2 rounded-md hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
              title={`Theme: ${themeLabel}`}
              aria-label={`Current theme: ${themeLabel}. Click to cycle theme.`}
            >
              <ThemeIcon className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={onLogout}
              className="text-theme-text-secondary px-3 py-2 rounded-md text-sm font-medium hover:bg-theme-surface-hover transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-theme-text-primary p-2 rounded-md hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
            aria-label={mobileMenuOpen ? 'Close main menu' : 'Open main menu'}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" aria-hidden="true" /> : <Menu className="w-6 h-6" aria-hidden="true" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav id="mobile-menu" className="md:hidden pb-4" aria-label="Mobile navigation">
            <div ref={mobileMenuRef} className="flex flex-col space-y-1">
              {navItems.map((item) => {
                // Filter sub-items by permission
                const visibleSubItems = item.subItems?.filter(
                  (sub) => !sub.permission || checkPermission(sub.permission)
                );

                // Skip top-level permission-gated items
                if (item.permission && !checkPermission(item.permission)) return null;

                // Skip parent groups where all sub-items are hidden
                if (item.subItems && visibleSubItems && visibleSubItems.length === 0) return null;

                const hasSubItems = !!visibleSubItems && visibleSubItems.length > 0;
                const isExpanded = expandedMobileMenus.includes(item.label);

                if (hasSubItems) {
                  return (
                    <div key={item.label}>
                      <button
                        onClick={() => toggleMobileMenu(item.label)}
                        aria-expanded={isExpanded}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                          isParentActive(item) ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                        }`}
                      >
                        {item.label}
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>
                      {isExpanded && (
                        <div className="ml-4 space-y-1 mt-1">
                          {visibleSubItems.map((subItem) => {
                            const subActive = isSubItemActive(subItem.path, item.subItems || []);
                            return (
                            <a
                              key={subItem.path}
                              href={subItem.path}
                              onClick={(e) => handleNavigation(subItem.path, e)}
                              aria-current={subActive ? 'page' : undefined}
                              className={`block px-3 py-2 rounded-md text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
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
                    className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      isActive(item.path) ? 'text-theme-text-primary font-bold' : 'text-theme-text-secondary'
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
              <button
                onClick={cycleTheme}
                className="text-theme-text-secondary px-3 py-2 rounded-md text-sm font-medium hover:bg-theme-surface-hover transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <ThemeIcon className="w-4 h-4" aria-hidden="true" />
                <span>Theme: {themeLabel}</span>
              </button>
              <button
                onClick={onLogout}
                className="text-theme-text-secondary px-3 py-2 rounded-md text-sm font-medium hover:bg-theme-surface-hover transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span>Logout</span>
              </button>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
};
