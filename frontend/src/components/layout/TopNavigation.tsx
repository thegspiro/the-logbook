import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, LogOut, Menu, X } from 'lucide-react';

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

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', active: true },
    { label: 'Members', path: '/members', active: false },
    { label: 'Events', path: '/events', active: false },
    { label: 'Reports', path: '#', active: false },
    { label: 'Settings', path: '#', active: false },
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
    <header className="bg-slate-900/50 backdrop-blur-sm border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Department Name */}
          <div className="flex items-center">
            {logoPreview ? (
              <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
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
              <p className="text-slate-400 text-xs">Dashboard</p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-4">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.path}
                onClick={(e) => handleNavigation(item.path, e)}
                className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors ${
                  item.active ? 'text-white' : 'text-slate-300'
                }`}
              >
                {item.label}
              </a>
            ))}
            <button
              onClick={onLogout}
              className="text-slate-300 px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors flex items-center space-x-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </nav>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-white p-2 rounded-md hover:bg-white/10 transition-colors"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden pb-4">
            <div className="flex flex-col space-y-2">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.path}
                  onClick={(e) => handleNavigation(item.path, e)}
                  className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors ${
                    item.active ? 'text-white' : 'text-slate-300'
                  }`}
                >
                  {item.label}
                </a>
              ))}
              <button
                onClick={onLogout}
                className="text-slate-300 px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 transition-colors flex items-center space-x-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
