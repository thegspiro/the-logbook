import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission?: string;
  requiredRole?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredPermission,
  requiredRole,
}) => {
  const location = useLocation();
  const { isAuthenticated, isLoading, user, loadUser, checkPermission, hasRole } = useAuthStore();

  // Check if there's an active session that hasn't been validated yet.
  // Without this, the first render sees isLoading=false + isAuthenticated=false
  // and immediately redirects to /login before loadUser() in the useEffect
  // gets a chance to validate the token via httpOnly cookie.
  // NOTE: We check `has_session` (a lightweight flag), NOT `access_token`.
  // Actual auth tokens live in httpOnly cookies and are never in localStorage.
  const hasStoredToken = !!localStorage.getItem('has_session');

  useEffect(() => {
    // Try to load user from token on mount
    if (!user && !isLoading && hasStoredToken) {
      void loadUser();
    }
  }, [user, isLoading, loadUser, hasStoredToken]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-theme-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // If there's a stored token but user isn't loaded yet, show spinner
  // instead of redirecting. loadUser() will resolve this on the next render.
  if (!isAuthenticated && hasStoredToken && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-theme-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Force password change if required by admin or expired
  const needsPasswordChange = user?.must_change_password || user?.password_expired;
  if (needsPasswordChange && location.pathname !== '/account') {
    return <Navigate to="/account" state={{ forcePasswordChange: true }} replace />;
  }

  // Check for required permission
  if (requiredPermission && !checkPermission(requiredPermission)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-theme-text-primary mb-4">Access Denied</h2>
          <p className="text-theme-text-secondary mb-6">
            You do not have the required permissions to access this page.
          </p>
          <a
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // Check for required role
  if (requiredRole && !hasRole(requiredRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-theme-text-primary mb-4">Access Denied</h2>
          <p className="text-theme-text-secondary mb-6">
            You do not have the required role to access this page.
          </p>
          <a
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // User is authenticated and authorized
  return <>{children}</>;
};
