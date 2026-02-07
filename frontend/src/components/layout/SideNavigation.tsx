import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  Users,
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
  Globe
} from 'lucide-react';

interface SideNavigationProps {
  departmentName: string;
  logoPreview: string | null;
  onLogout: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  subItems?: { label: string; path: string; icon: React.ElementType }[];
}

export const SideNavigation: React.FC<SideNavigationProps> = ({
  departmentName,
  logoPreview,
  onLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>(['Settings']);

  const navItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: Home },
    { label: 'Members', path: '/members', icon: Users },
    { label: 'Events', path: '/events', icon: Calendar },
    { label: 'Reports', path: '#', icon: FileText },
    {
      label: 'Settings',
      path: '/settings',
      icon: Settings,
      subItems: [
        { label: 'Organization', path: '/settings', icon: Building2 },
        { label: 'Role Management', path: '/settings/roles', icon: Shield },
        { label: 'Member Admin', path: '/admin/members', icon: UserCog },
        { label: 'Public Portal', path: '/admin/public-portal', icon: Globe },
      ],
    },
  ];

  const isActive = (path: string) => {
    if (path === '#') return false;
    return location.pathname === path || location.pathname.startsWith(path + '/');
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
      <header className="lg:hidden bg-slate-900/50 backdrop-blur-sm border-b border-white/10 fixed top-0 left-0 right-0 z-50" role="banner">
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
            <div className="ml-3">
              <span className="text-white text-lg font-semibold">{departmentName}</span>
            </div>
          </a>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-white p-2 rounded-md hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
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
        id="side-navigation"
        role="navigation"
        aria-label="Main navigation"
        className={`fixed top-0 left-0 h-full bg-slate-900/95 backdrop-blur-sm border-r border-white/10 transition-all duration-300 z-40 ${
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
                  <div className="ml-3 overflow-hidden">
                    <span className="text-white text-sm font-semibold truncate block">
                      {departmentName}
                    </span>
                    <p className="text-slate-300 text-xs">Dashboard</p>
                  </div>
                )}
              </a>
              {!collapsed && (
                <button
                  onClick={() => setCollapsed(true)}
                  className="hidden lg:block text-slate-300 hover:text-white p-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                  aria-label="Collapse navigation"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" aria-hidden="true" />
                </button>
              )}
            </div>
            {collapsed && (
              <button
                onClick={() => setCollapsed(false)}
                className="hidden lg:block mt-2 w-full text-slate-300 hover:text-white p-2 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                aria-label="Expand navigation"
              >
                <ChevronRight className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Side navigation">
            <ul role="list" className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const hasSubItems = !!item.subItems;
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
                          ? 'bg-white/5 text-white'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white'
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
                        {item.subItems!.map((subItem) => {
                          const SubIcon = subItem.icon;
                          const subActive = isActive(subItem.path);
                          return (
                            <li key={subItem.path}>
                              <button
                                onClick={() => handleNavigation(subItem.path)}
                                aria-current={subActive ? 'page' : undefined}
                                className={`w-full flex items-center px-4 py-2 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-red-500 ${
                                  subActive
                                    ? 'bg-red-600 text-white'
                                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
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

          {/* Logout Button */}
          <div className="p-4 border-t border-white/10">
            <button
              onClick={onLogout}
              className={`w-full flex items-center text-slate-300 hover:bg-white/10 hover:text-white rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-red-500 ${
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
