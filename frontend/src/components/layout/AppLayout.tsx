import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import axios from 'axios';
import { TopNavigation } from './TopNavigation';
import { SideNavigation } from './SideNavigation';
import { LogoutConfirmModal } from '../LogoutConfirmModal';
import { useAuthStore } from '../../stores/authStore';
import { useIdleTimer } from '../../hooks/useIdleTimer';

interface AppLayoutProps {
  children?: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const _location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const _user = useAuthStore((s) => s.user);
  const [departmentName, setDepartmentName] = useState('Fire Department');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [navigationLayout, setNavigationLayout] = useState<'top' | 'left'>(
    () => (localStorage.getItem('navigationLayout') as 'top' | 'left') || 'left'
  );
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Session inactivity timeout (configurable, fetched from backend, with warning toast)
  useIdleTimer();

  useEffect(() => {
    // Load branding from localStorage first (persists across sessions/logout)
    const savedDepartmentName = localStorage.getItem('departmentName');
    const savedLogo = localStorage.getItem('logoData');

    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    }
    if (savedLogo) {
      setLogoPreview(savedLogo);
    }

    // If localStorage is empty (first visit), fetch branding from backend
    if (!savedDepartmentName) {
      axios.get('/api/v1/auth/branding').then((response) => {
        const { name, logo } = response.data;
        if (name) {
          setDepartmentName(name);
          localStorage.setItem('departmentName', name);
        }
        if (logo) {
          setLogoPreview(logo);
          localStorage.setItem('logoData', logo);
        }
      }).catch(() => {
        // Branding is non-critical — keep defaults
      });
    }
  }, []);

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleLogoutConfirm = async () => {
    await logout();
    sessionStorage.clear();
    navigate('/login');
  };

  const handleLogoutCancel = () => {
    setShowLogoutModal(false);
  };

  const content = children ?? <Outlet />;

  const footer = (
    <footer className="bg-theme-input-bg backdrop-blur-sm border-t border-theme-surface-border mt-auto" role="contentinfo">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-center text-theme-text-secondary text-sm">
          &copy; {new Date().getFullYear()} {departmentName}. All rights reserved.
        </p>
        <p className="text-center text-theme-text-muted text-xs mt-1">
          Powered by The Logbook
        </p>
      </div>
    </footer>
  );

  if (navigationLayout === 'left') {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(to bottom right, var(--bg-gradient-from), var(--bg-gradient-via), var(--bg-gradient-to))' }}>
        {/* Skip to main content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-red-600 focus:text-white focus:rounded-md focus:outline-none focus:ring-2 focus:ring-white"
        >
          Skip to main content
        </a>
        <SideNavigation
          departmentName={departmentName}
          logoPreview={logoPreview}
          onLogout={handleLogoutClick}
        />
        <div className="md:ml-64 min-h-screen flex flex-col pt-16 md:pt-0">
          <div className="flex-1" id="main-content" role="main">
            {content}
          </div>
          <div className="md:ml-0">{footer}</div>
        </div>
        <LogoutConfirmModal
          isOpen={showLogoutModal}
          onConfirm={handleLogoutConfirm}
          onCancel={handleLogoutCancel}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(to bottom right, var(--bg-gradient-from), var(--bg-gradient-via), var(--bg-gradient-to))' }}>
      {/* Skip to main content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-red-600 focus:text-white focus:rounded-md focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>
      <TopNavigation
        departmentName={departmentName}
        logoPreview={logoPreview}
        onLogout={handleLogoutClick}
      />
      <div className="flex-1" id="main-content" role="main">
        {content}
      </div>
      {footer}
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        onConfirm={handleLogoutConfirm}
        onCancel={handleLogoutCancel}
      />
    </div>
  );
};
