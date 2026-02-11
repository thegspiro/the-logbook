import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, LogOut, Menu, X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface TopNavigationProps {
  departmentName: string;
  logoPreview: string | null;
  onLogout: () => void;
}

export const TopNavigation: React.FC<TopNavigationProps> = ({
  departmentName,
  logoPreview,
  onLogout,
}) => {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useFocusTrap<HTMLDivElement>(mobileMenuOpen);

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', active: true },
    { label: 'Members', path: '/members', active: false },
    { label: 'Events', path: '/events', active: false },
    { label: 'Reports', path: '/reports', active: false },
    { label: 'Settings', path: '/settings', active: false },
  ];

  const handleNavigation = (path: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
    }
    if (path !== '#') {
      navigate(path);
      setMobileMenuOpen(false);
    }
  };

  return (
    <header className="bg-slate-900 border-b border-white/10" role="banner">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Department Name */}
          <a href="/dashboard" className="flex items-center focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900 rounded-lg">
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
              <p className="text-slate-300 text-xs">Dashboard</p>
            </div>
          </a>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-4" aria-label="Main navigation">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.path}
                onClick={(e) => handleNavigation(item.path, e)}
                aria-current={item.active ? 'page' : undefined}
                className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  item.active ? 'text-white' : 'text-slate-300'
                }`}
              >
                {item.label}
              </a>
            ))}
            <button
              onClick={onLogout}
              className="text-slate-300 px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-white p-2 rounded-md hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
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
            <div ref={mobileMenuRef} className="flex flex-col space-y-2">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.path}
                  onClick={(e) => handleNavigation(item.path, e)}
                  aria-current={item.active ? 'page' : undefined}
                  className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    item.active ? 'text-white' : 'text-slate-300'
                  }`}
                >
                  {item.label}
                </a>
              ))}
              <button
                onClick={onLogout}
                className="text-slate-300 px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-red-500"
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
