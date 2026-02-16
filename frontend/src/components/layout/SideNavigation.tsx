import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  Users,
  UserPlus,
  Calendar,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  Shield,
  Building2,
  UserCog,
  Globe,
  GraduationCap,
  Package,
  Clock,
  Truck,
  Vote,
  ClipboardList,
  BarChart3,
  Bell,
  FormInput,
  Plug,
  Send,
} from 'lucide-react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthStore } from '../../stores/authStore';

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
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  permission?: string;
  subItems?: SubNavItem[];
}

export const SideNavigation: React.FC<SideNavigationProps> = ({
  departmentName,
  logoPreview,
  onLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { checkPermission } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['Settings']);
  const sideNavRef = useFocusTrap<HTMLElement>(mobileMenuOpen);

  // Auto-expand parent menu when navigating to a child route
  useEffect(() => {
    setExpandedMenus(prev => {
      const activeParent = navItems.find(item =>
        item.subItems?.some(sub => location.pathname === sub.path || location.pathname.startsWith(sub.path + '/'))
      );
      if (activeParent && !prev.includes(activeParent.label)) {
        return [...prev, activeParent.label];
      }
      return prev;
    });
  }, [location.pathname]);

  const cycleTheme = () => {
    const order = ['light', 'dark', 'system'] as const;
    const currentIndex = order.indexOf(theme as typeof order[number]);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex]);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  const navItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: Home },
    {
      label: 'Members',
      path: '#',
      icon: Users,
      subItems: [
        { label: 'All Members', path: '/members', icon: Users },
        { label: 'Prospective', path: '/prospective-members', icon: UserPlus, permission: 'prospective_members.manage' },
      ],
    },
    { label: 'Events', path: '/events', icon: Calendar },
    { label: 'Documents', path: '/documents', icon: FileText },
    {
      label: 'Training',
      path: '#',
      icon: GraduationCap,
      subItems: [
        { label: 'My Training', path: '/training/my-training', icon: ClipboardList },
        { label: 'Submit Training', path: '/training/submit', icon: Send },
        { label: 'Dashboard', path: '/training/dashboard', icon: BarChart3, permission: 'training.manage' },
      ],
    },
    {
      label: 'Operations',
      path: '#',
      icon: Package,
      subItems: [
        { label: 'Inventory', path: '/inventory', icon: Package },
        { label: 'Scheduling', path: '/scheduling', icon: Clock },
        { label: 'Apparatus', path: '/apparatus', icon: Truck },
      ],
    },
    {
      label: 'Governance',
      path: '#',
      icon: Vote,
      subItems: [
        { label: 'Elections', path: '/elections', icon: Vote },
        { label: 'Minutes', path: '/minutes', icon: ClipboardList },
        { label: 'Reports', path: '/reports', icon: BarChart3 },
      ],
    },
    {
      label: 'Communication',
      path: '#',
      icon: Bell,
      subItems: [
        { label: 'Notifications', path: '/notifications', icon: Bell },
        { label: 'Forms', path: '/forms', icon: FormInput },
        { label: 'Integrations', path: '/integrations', icon: Plug },
      ],
    },
    {
      label: 'Settings',
      path: '/settings',
      icon: Settings,
      subItems: [
        { label: 'My Account', path: '/settings/account', icon: UserCog },
        { label: 'Organization', path: '/settings', icon: Building2 },
        { label: 'Role Management', path: '/settings/roles', icon: Shield, permission: 'roles.manage' },
        { label: 'Member Admin', path: '/admin/members', icon: UserCog, permission: 'members.manage' },
        { label: 'Public Portal', path: '/admin/public-portal', icon: Globe, permission: 'settings.manage' },
      ],
    },
  ];

  const isActive = (path: string) => {
    if (path === '#') return false;
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isSubItemActive = (path: string, siblings: { path: string }[]) => {
    if (path === '#') return false;
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

  const toggleMenu = (label: string) => {
    setExpandedMenus(prev =>
      prev.includes(label) ? prev.filter(m => m !== label) : [...prev, label]
    );
  };

  const handleNavigation = (path: string, hasSubItems?: boolean, label?: string) => {
    if (hasSubItems && !collapsed) {
      toggleMenu(label!);
      return;
    }
    if (path !== '#') {
      navigate(path);
      setMobileMenuOpen(false);
    }
  };

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden bg-slate-900 border-b border-theme-surface-border fixed top-0 left-0 right-0 z-50" role="banner">
        <div className="flex items-center justify-between h-16 px-4">
          <a href="/dashboard" className="flex items-center focus:outline-none focus:ring-2 focus:ring-red-500 rounded-lg">
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
            <div className="ml-3 min-w-0 flex-1">
              <span className="text-white text-lg font-semibold break-words leading-tight">{departmentName}</span>
            </div>
          </a>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-theme-text-primary p-2 rounded-md hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
            aria-expanded={mobileMenuOpen}
            aria-controls="side-navigation"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" aria-hidden="true" /> : <Menu className="w-6 h-6" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40 mt-16"
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
        className={`fixed top-0 left-0 h-full bg-slate-900 border-r border-theme-surface-border transition-all duration-300 z-40 ${
          collapsed ? 'w-20' : 'w-64'
        } ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="flex flex-col h-full">
          {/* Logo Section */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center justify-between">
              <a href="/dashboard" className="flex items-center overflow-hidden focus:outline-none focus:ring-2 focus:ring-red-500 rounded-lg">
                {logoPreview ? (
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                    <img
                      src={logoPreview}
                      alt=""
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0" aria-hidden="true">
                    <Home className="w-6 h-6 text-white" />
                  </div>
                )}
                {!collapsed && (
                  <div className="ml-3 min-w-0">
                    <span className="text-white text-sm font-semibold block break-words leading-tight">
                      {departmentName}
                    </span>
                    <p className="text-slate-300 text-xs">Dashboard</p>
                  </div>
                )}
              </a>
              {!collapsed && (
                <button
                  onClick={() => setCollapsed(false)}
                  className="hidden lg:block mt-2 w-full text-theme-text-secondary hover:text-theme-text-primary p-2 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                  aria-label="Expand navigation"
                >
                  <ChevronRight className="w-5 h-5 mx-auto" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <a href="/dashboard" className="flex flex-col items-center w-full focus:outline-none focus:ring-2 focus:ring-red-500 rounded-lg">
                    {logoPreview ? (
                      <div className="w-14 h-14 rounded-lg flex items-center justify-center overflow-hidden">
                        <img
                          src={logoPreview}
                          alt=""
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-14 h-14 bg-red-600 rounded-lg flex items-center justify-center" aria-hidden="true">
                        <Home className="w-8 h-8 text-white" />
                      </div>
                    )}
                    <span className="mt-2 text-theme-text-primary text-sm font-semibold truncate block text-center w-full">
                      {departmentName}
                    </span>
                  </a>
                  <button
                    onClick={() => setCollapsed(true)}
                    className="hidden lg:block text-theme-text-secondary hover:text-theme-text-primary p-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 flex-shrink-0"
                    aria-label="Collapse navigation"
                  >
                    <ChevronRight className="w-5 h-5 rotate-180" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Side navigation">
            <ul role="list" className="space-y-1">
              {navItems.map((item) => {
                // Filter sub-items by permission
                const visibleSubItems = item.subItems?.filter(
                  (sub) => !sub.permission || checkPermission(sub.permission)
                );

                // Skip top-level permission-gated items
                if (item.permission && !checkPermission(item.permission)) return null;

                // Skip parent groups where all sub-items are hidden
                if (item.subItems && visibleSubItems && visibleSubItems.length === 0) return null;

                const Icon = item.icon;
                const hasSubItems = !!visibleSubItems && visibleSubItems.length > 0;
                const isExpanded = expandedMenus.includes(item.label);
                const parentActive = isParentActive(item);

                return (
                  <li key={item.label}>
                    <button
                      onClick={() => handleNavigation(item.path, hasSubItems, item.label)}
                      aria-current={parentActive && !hasSubItems ? 'page' : undefined}
                      aria-expanded={hasSubItems ? isExpanded : undefined}
                      aria-controls={hasSubItems ? `submenu-${item.label}` : undefined}
                      className={`w-full flex items-center rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-red-500 ${
                        collapsed ? 'justify-center p-3' : 'px-4 py-3'
                      } ${
                        parentActive && !hasSubItems
                          ? 'bg-red-600 text-white'
                          : parentActive && hasSubItems
                          ? 'bg-theme-surface-secondary text-theme-text-primary'
                          : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                      }`}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                    >
                      <Icon className={`w-5 h-5 flex-shrink-0 ${collapsed ? '' : 'mr-3'}`} aria-hidden="true" />
                      {!collapsed && (
                        <>
                          <span className="text-sm font-medium flex-1 text-left">{item.label}</span>
                          {hasSubItems && (
                            <ChevronDown
                              className={`w-4 h-4 transition-transform ${
                                isExpanded ? 'rotate-180' : ''
                              }`}
                              aria-hidden="true"
                            />
                          )}
                        </>
                      )}
                    </button>

                    {/* Sub Items */}
                    {hasSubItems && isExpanded && !collapsed && (
                      <ul id={`submenu-${item.label}`} className="mt-1 ml-4 space-y-1" role="list">
                        {visibleSubItems!.map((subItem) => {
                          const SubIcon = subItem.icon;
                          const subActive = isSubItemActive(subItem.path, item.subItems || []);
                          return (
                            <li key={subItem.path}>
                              <button
                                onClick={() => handleNavigation(subItem.path)}
                                aria-current={subActive ? 'page' : undefined}
                                className={`w-full flex items-center px-4 py-2 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-red-500 ${
                                  subActive
                                    ? 'bg-red-600 text-white'
                                    : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                                }`}
                              >
                                <SubIcon className="w-4 h-4 mr-3 flex-shrink-0" aria-hidden="true" />
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
          <div className="p-4 border-t border-theme-surface-border space-y-1">
            <button
              onClick={cycleTheme}
              className={`w-full flex items-center text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-red-500 ${
                collapsed ? 'justify-center p-3' : 'px-4 py-3'
              }`}
              title={collapsed ? `Theme: ${themeLabel}` : undefined}
              aria-label={`Current theme: ${themeLabel}. Click to cycle theme.`}
            >
              <ThemeIcon className={`w-5 h-5 flex-shrink-0 ${collapsed ? '' : 'mr-3'}`} aria-hidden="true" />
              {!collapsed && <span className="text-sm font-medium">Theme: {themeLabel}</span>}
            </button>
            <button
              onClick={onLogout}
              className={`w-full flex items-center text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-red-500 ${
                collapsed ? 'justify-center p-3' : 'px-4 py-3'
              }`}
              title={collapsed ? 'Logout' : undefined}
              aria-label={collapsed ? 'Logout' : undefined}
            >
              <LogOut className={`w-5 h-5 flex-shrink-0 ${collapsed ? '' : 'mr-3'}`} aria-hidden="true" />
              {!collapsed && <span className="text-sm font-medium">Logout</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
