import React, { useEffect, useState } from 'react';
import { useNavigate, Outlet } from 'react-router';
import axios from 'axios';
import { TopNavigation } from './TopNavigation';
import { SideNavigation } from './SideNavigation';
import { ConfirmDialog } from '../ux/ConfirmDialog';
import { useAuthStore } from '../../stores/authStore';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import { TopProgressBar, CommandPalette, PageTransition } from '../ux';
import { useNavigationShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useNotificationPoller } from '../../hooks/useNotificationCount';
import { useOfflineSyncEngine } from '../../hooks/useOfflineSyncEngine';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { usePullToRefreshContext } from '../../contexts/PullToRefreshContext';
import { PullToRefreshIndicator } from '../PullToRefreshIndicator';
import { BottomNavigation } from './BottomNavigation';

/** SEC: Validate logo URL protocol to prevent javascript: or data:text/html XSS.
 *  Only safe raster image data URIs are allowed — SVG can contain embedded JS. */
function isValidLogoUrl(url: string): boolean {
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('/') ||
    url.startsWith('data:image/png') ||
    url.startsWith('data:image/jpeg') ||
    url.startsWith('data:image/webp') ||
    url.startsWith('data:image/gif')
  );
}

interface AppLayoutProps {
  children?: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [departmentName, setDepartmentName] = useState('Fire Department');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [navigationLayout, _setNavigationLayout] = useState<'top' | 'left'>(
    () => (localStorage.getItem('navigationLayout') as 'top' | 'left') || 'left'
  );
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Session inactivity timeout (configurable, fetched from backend, with warning toast)
  useIdleTimer();

  // Keyboard shortcuts for navigation (#39)
  useNavigationShortcuts();

  // Poll for unread notification count (shared across nav components)
  useNotificationPoller();

  // Drain the offline write queue when connectivity returns
  useOfflineSyncEngine();

  // Publish the on-screen keyboard height so bottom action bars clear it
  const keyboardInset = useKeyboardInset();

  // Layout-level pull-to-refresh: pages opt in via useRegisterPullToRefresh,
  // supplying their own data-refresh handler. The gesture stays disabled until
  // a page registers one, so no spinner appears on pages that don't support it.
  const ptr = usePullToRefreshContext();
  const runRefresh = ptr?.runRefresh;
  const { pulling, refreshing, pullDistance } = usePullToRefresh({
    onRefresh: runRefresh ?? (() => Promise.resolve()),
    disabled: !ptr?.hasHandler,
  });

  useEffect(() => {
    // Load branding from localStorage first (persists across sessions/logout)
    const savedDepartmentName = localStorage.getItem('departmentName');
    const savedLogo = localStorage.getItem('logoData');

    if (savedDepartmentName) {
      setDepartmentName(savedDepartmentName);
    }
    if (savedLogo && isValidLogoUrl(savedLogo)) {
      setLogoPreview(savedLogo);
    }

    // If localStorage is empty (first visit), fetch branding from backend
    if (!savedDepartmentName) {
      void axios
        .get<{ name?: string; logo?: string }>('/api/v1/auth/branding')
        .then((response) => {
          const { name, logo } = response.data;
          if (name) {
            setDepartmentName(name);
            localStorage.setItem('departmentName', name);
          }
          if (logo && isValidLogoUrl(logo)) {
            setLogoPreview(logo);
            localStorage.setItem('logoData', logo);
          }
        })
        .catch(() => {
          // Branding is non-critical — keep defaults
        });
    }

    // Listen for branding updates from the Settings page (same-tab)
    const onBrandingUpdate = (e: Event) => {
      const { name, logo } = (e as CustomEvent<{ name?: string; logo?: string }>).detail;
      if (name) setDepartmentName(name);
      setLogoPreview(logo || null);
    };
    window.addEventListener('branding-updated', onBrandingUpdate);
    return () => window.removeEventListener('branding-updated', onBrandingUpdate);
  }, []);

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleLogoutConfirm = async () => {
    await logout();
    sessionStorage.clear();
    void navigate('/login');
  };

  const handleLogoutCancel = () => {
    setShowLogoutModal(false);
  };

  const content = children ?? <Outlet />;

  const footer = (
    <footer
      className="bg-theme-input-bg/80 border-theme-surface-border mt-auto border-t backdrop-blur-sm"
      role="contentinfo"
    >
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-theme-text-secondary text-center text-sm">
          &copy; {new Date().getFullYear()} {departmentName}. All rights reserved.
        </p>
        <p className="text-theme-text-muted mt-1.5 text-center text-xs tracking-wide">Powered by The Logbook</p>
        <p className="text-theme-text-muted mt-2 text-center text-[11px]">
          End-to-end encrypted &middot; Self-hosted &middot; HIPAA-aware
        </p>
      </div>
    </footer>
  );

  if (navigationLayout === 'left') {
    return (
      <div
        className="has-bottom-nav flex min-h-screen flex-col"
        style={{
          background:
            'linear-gradient(to bottom right, var(--bg-gradient-from), var(--bg-gradient-via), var(--bg-gradient-to))',
        }}
      >
        <TopProgressBar />
        <PullToRefreshIndicator pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
        <CommandPalette />
        {/* Skip to main content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-red-600 focus:px-4 focus:py-2 focus:text-white focus:ring-2 focus:ring-white focus:outline-hidden"
        >
          Skip to main content
        </a>
        <SideNavigation departmentName={departmentName} logoPreview={logoPreview} onLogout={handleLogoutClick} />
        <div className="mobile-header-offset flex min-h-screen flex-col md:ml-64">
          <div className="flex-1" id="main-content" role="main">
            <PageTransition>{content}</PageTransition>
          </div>
          {/* Reserve room so the fixed bottom bar never covers the footer. */}
          <div className="pb-[var(--bottom-nav-height,0px)] md:ml-0">{footer}</div>
        </div>
        <BottomNavigation hidden={keyboardInset > 0} />
        <ConfirmDialog
          isOpen={showLogoutModal}
          onConfirm={() => {
            void handleLogoutConfirm();
          }}
          onClose={handleLogoutCancel}
          title="Confirm Logout"
          message="Are you sure you want to log out? Any unsaved changes may be lost."
          confirmLabel="Logout"
          variant="danger"
        />
      </div>
    );
  }

  return (
    <div
      className="has-bottom-nav flex min-h-screen flex-col"
      style={{
        background:
          'linear-gradient(to bottom right, var(--bg-gradient-from), var(--bg-gradient-via), var(--bg-gradient-to))',
      }}
    >
      <TopProgressBar />
      <PullToRefreshIndicator pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <CommandPalette />
      {/* Skip to main content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-red-600 focus:px-4 focus:py-2 focus:text-white focus:ring-2 focus:ring-white focus:outline-hidden"
      >
        Skip to main content
      </a>
      <TopNavigation departmentName={departmentName} logoPreview={logoPreview} onLogout={handleLogoutClick} />
      <div className="flex-1" id="main-content" role="main">
        <PageTransition>{content}</PageTransition>
      </div>
      {/* Reserve room so the fixed bottom bar never covers the footer. */}
      <div className="pb-[var(--bottom-nav-height,0px)]">{footer}</div>
      <BottomNavigation hidden={keyboardInset > 0} />
      <ConfirmDialog
        isOpen={showLogoutModal}
        onConfirm={() => {
          void handleLogoutConfirm();
        }}
        onClose={handleLogoutCancel}
        title="Confirm Logout"
        message="Are you sure you want to log out? Any unsaved changes may be lost."
        confirmLabel="Logout"
        variant="danger"
      />
    </div>
  );
};
