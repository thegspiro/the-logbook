import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopNavigation } from './TopNavigation';
import { SideNavigation } from './SideNavigation';
import { LogoutConfirmModal } from '../LogoutConfirmModal';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const [departmentName, setDepartmentName] = useState('Fire Department');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [navigationLayout, setNavigationLayout] = useState<'top' | 'left'>('top');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    // Check if user is authenticated
    const authToken = localStorage.getItem('access_token');
    if (!authToken) {
      navigate('/login');
      return;
    }

    // Load department info and navigation preference
    const savedDepartmentName = sessionStorage.getItem('departmentName');
    const savedLogo = sessionStorage.getItem('logoData');
    const savedLayout = sessionStorage.getItem('navigationLayout') as 'top' | 'left' | null;

    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    }
    if (savedLogo) {
      setLogoPreview(savedLogo);
    }
    if (savedLayout) {
      setNavigationLayout(savedLayout);
    }
  }, [navigate]);

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleLogoutConfirm = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    sessionStorage.clear();
    navigate('/login');
  };

  const handleLogoutCancel = () => {
    setShowLogoutModal(false);
  };

  if (navigationLayout === 'left') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
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
        <div className="lg:ml-64 min-h-screen pt-16 lg:pt-0" id="main-content" role="main">
          {children}
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
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
      <div id="main-content" role="main">
        {children}
      </div>
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        onConfirm={handleLogoutConfirm}
        onCancel={handleLogoutCancel}
      />
    </div>
  );
};
