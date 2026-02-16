import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, LogOut, Menu, X, Sun, Moon, Monitor, ChevronDown } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthStore } from '../../stores/authStore';

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

  const cycleTheme = () => {
    const order = ['light', 'dark', 'system'] as const;
    const currentIndex = order.indexOf(theme as typeof order[number]);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex]);
  };

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';
  const ThemeIcon = themeIcon;

  // Match the side navigation structure
  const navItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard' },
    {
      label: 'Members',
      path: '/members',
      subItems: [
        { label: 'All Members', path: '/members' },
        { label: 'Prospective', path: '/prospective-members', permission: 'prospective_members.manage' },
      ],
    },
    { label: 'Events', path: '/events' },
    { label: 'Documents', path: '/documents' },
    {
      label: 'Training',
      path: '/training/my-training',
      subItems: [
        { label: 'My Training', path: '/training/my-training' },
        { label: 'Submit Training', path: '/training/submit' },
        { label: 'Dashboard', path: '/training/dashboard', permission: 'training.manage' },
      ],
    },
    {
      label: 'Operations',
      path: '/inventory',
      subItems: [
        { label: 'Inventory', path: '/inventory' },
        { label: 'Scheduling', path: '/scheduling' },
        { label: 'Apparatus', path: '/apparatus' },
      ],
    },
    {
      label: 'Governance',
      path: '/elections',
      subItems: [
        { label: 'Elections', path: '/elections' },
        { label: 'Minutes', path: '/minutes' },
        { label: 'Reports', path: '/reports' },
      ],
    },
    {
      label: 'Communication',
      path: '/notifications',
      subItems: [
        { label: 'Notifications', path: '/notifications' },
        { label: 'Forms', path: '/forms' },
        { label: 'Integrations', path: '/integrations' },
      ],
    },
    {
      label: 'Settings',
      path: '/settings',
      subItems: [
        { label: 'My Account', path: '/settings/account' },
        { label: 'Organization', path: '/settings' },
        { label: 'Role Management', path: '/settings/roles', permission: 'roles.manage' },
        { label: 'Member Admin', path: '/admin/members', permission: 'members.manage' },
        { label: 'Public Portal', path: '/admin/public-portal', permission: 'settings.manage' },
      ],
    },
  ];

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
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
            <div className="ml-3">
              <span className="text-theme-text-primary text-lg font-semibold">{departmentName}</span>
              <p className="text-theme-text-secondary text-xs">Dashboard</p>
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
                      className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 flex items-center gap-1 ${
                        active ? 'text-white' : 'text-slate-300'
                      }`}
                    >
                      {item.label}
                      <ChevronDown className={`w-3 h-3 transition-transform ${openDropdown === item.label ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>

                    {openDropdown === item.label && (
                      <div className="absolute top-full left-0 mt-1 w-48 bg-slate-800 border border-white/10 rounded-lg shadow-xl py-1 z-50">
                        {visibleSubItems!.map((subItem) => (
                          <a
                            key={subItem.path}
                            href={subItem.path}
                            onClick={(e) => handleNavigation(subItem.path, e)}
                            aria-current={isActive(subItem.path) ? 'page' : undefined}
                            className={`block px-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500 ${
                              isActive(subItem.path)
                                ? 'bg-red-600 text-white'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            {subItem.label}
                          </a>
                        ))}
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
                  className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    active ? 'text-white' : 'text-slate-300'
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
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                          isParentActive(item) ? 'text-white' : 'text-slate-300'
                        }`}
                      >
                        {item.label}
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>
                      {isExpanded && (
                        <div className="ml-4 space-y-1 mt-1">
                          {visibleSubItems!.map((subItem) => (
                            <a
                              key={subItem.path}
                              href={subItem.path}
                              onClick={(e) => handleNavigation(subItem.path, e)}
                              aria-current={isActive(subItem.path) ? 'page' : undefined}
                              className={`block px-3 py-2 rounded-md text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                                isActive(subItem.path)
                                  ? 'bg-red-600 text-white'
                                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              {subItem.label}
                            </a>
                          ))}
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
                    className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      isActive(item.path) ? 'text-white' : 'text-slate-300'
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
