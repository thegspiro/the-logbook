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
  UserCog
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
      <header className="lg:hidden bg-slate-900/50 backdrop-blur-sm border-b border-white/10 fixed top-0 left-0 right-0 z-50">
        <div className="flex items-center justify-between h-16 px-4">
          <div className="flex items-center">
            {logoPreview ? (
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center overflow-hidden">
                <img
                  src={logoPreview}
                  alt={`${departmentName} logo`}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : (
              <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center">
                <Home className="w-6 h-6 text-white" />
              </div>
            )}
            <div className="ml-3">
              <h1 className="text-white text-lg font-semibold">{departmentName}</h1>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-white p-2 rounded-md hover:bg-white/10 transition-colors"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40 mt-16"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Side Navigation */}
      <aside
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
              <div className="flex items-center overflow-hidden">
                {logoPreview ? (
                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                    <img
                      src={logoPreview}
                      alt={`${departmentName} logo`}
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Home className="w-6 h-6 text-white" />
                  </div>
                )}
                {!collapsed && (
                  <div className="ml-3 overflow-hidden">
                    <h1 className="text-white text-sm font-semibold truncate">
                      {departmentName}
                    </h1>
                    <p className="text-slate-400 text-xs">Dashboard</p>
                  </div>
                )}
              </div>
              {!collapsed && (
                <button
                  onClick={() => setCollapsed(true)}
                  className="hidden lg:block text-slate-400 hover:text-white p-1 rounded transition-colors"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                </button>
              )}
            </div>
            {collapsed && (
              <button
                onClick={() => setCollapsed(false)}
                className="hidden lg:block mt-2 w-full text-slate-400 hover:text-white p-2 rounded transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const hasSubItems = !!item.subItems;
              const isExpanded = expandedMenus.includes(item.label);
              const parentActive = isParentActive(item);

              return (
                <div key={item.label}>
                  <button
                    onClick={() => handleNavigation(item.path, hasSubItems, item.label)}
                    className={`w-full flex items-center rounded-lg transition-all ${
                      collapsed ? 'justify-center p-3' : 'px-4 py-3'
                    } ${
                      parentActive && !hasSubItems
                        ? 'bg-red-600 text-white'
                        : parentActive && hasSubItems
                        ? 'bg-white/5 text-white'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 ${collapsed ? '' : 'mr-3'}`} />
                    {!collapsed && (
                      <>
                        <span className="text-sm font-medium flex-1 text-left">{item.label}</span>
                        {hasSubItems && (
                          <ChevronDown
                            className={`w-4 h-4 transition-transform ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                          />
                        )}
                      </>
                    )}
                  </button>

                  {/* Sub Items */}
                  {hasSubItems && isExpanded && !collapsed && (
                    <div className="mt-1 ml-4 space-y-1">
                      {item.subItems!.map((subItem) => {
                        const SubIcon = subItem.icon;
                        const subActive = isActive(subItem.path);
                        return (
                          <button
                            key={subItem.path}
                            onClick={() => handleNavigation(subItem.path)}
                            className={`w-full flex items-center px-4 py-2 rounded-lg transition-all ${
                              subActive
                                ? 'bg-red-600 text-white'
                                : 'text-slate-400 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <SubIcon className="w-4 h-4 mr-3 flex-shrink-0" />
                            <span className="text-sm">{subItem.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Logout Button */}
          <div className="p-4 border-t border-white/10">
            <button
              onClick={onLogout}
              className={`w-full flex items-center text-slate-300 hover:bg-white/10 hover:text-white rounded-lg transition-all ${
                collapsed ? 'justify-center p-3' : 'px-4 py-3'
              }`}
              title={collapsed ? 'Logout' : undefined}
            >
              <LogOut className={`w-5 h-5 flex-shrink-0 ${collapsed ? '' : 'mr-3'}`} />
              {!collapsed && <span className="text-sm font-medium">Logout</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
