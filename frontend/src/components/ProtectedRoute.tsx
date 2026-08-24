import React, { useEffect } from 'react';
import { Navigate, useLocation, Link } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import { useEnabledModules } from '../hooks/useEnabledModules';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission?: string;
  /** Any one of these permissions grants access (OR logic). */
  requiredAnyPermission?: string[];
  requiredRole?: string;
  /**
   * Organization module key (as in `Organization.settings.modules`) this route
   * belongs to. When the department has the module switched off, the route
   * refuses rather than rendering — otherwise a bookmark or a typed URL is a
   * way into a feature the navigation has hidden, and an admin can spend an
   * evening configuring something no member can see.
   *
   * This is a usability gate, not an access control: the API is not module-
   * aware and a module flag is not a permission. Keep the permission props
   * doing the actual gating.
   */
  requiredModule?: string;
  /** Display name for the module, used in the refusal copy. */
  moduleLabel?: string;
}

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="w-full max-w-md text-center">{children}</div>
  </div>
);

const Spinner: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="text-center">
      <div
        className="inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-red-600"
        role="status"
        aria-live="polite"
        aria-label="Loading"
      />
      <p className="text-theme-text-secondary mt-4" aria-live="polite">
        Loading...
      </p>
    </div>
  </div>
);

/**
 * Renders children only once the organization is known to have the module on.
 *
 * Deliberately mounted *after* ProtectedRoute's auth and permission checks
 * pass, so an unauthenticated visitor hitting a protected URL does not fire an
 * organization lookup that can only 401.
 */
const ModuleGate: React.FC<{
  module: string;
  label?: string | undefined;
  children: React.ReactNode;
}> = ({ module, label, children }) => {
  const { isModuleOn, isLoading } = useEnabledModules();
  const checkPermission = useAuthStore((state) => state.checkPermission);

  // Waits for the answer rather than rendering optimistically: the permissive
  // default is right for a nav bar, but here it would show the page and then
  // snatch it back, firing the page's own requests on the way through.
  if (isLoading) return <Spinner />;
  if (isModuleOn(module)) return <>{children}</>;

  const name = label ?? 'This feature';
  return (
    <Centered>
      <h2 className="text-theme-text-primary mb-4 text-2xl font-bold">{name} is not enabled</h2>
      <p className="text-theme-text-secondary mb-6">
        Your department has this module switched off, so it is hidden from everyone. An administrator can turn it on
        under Settings → Modules.
      </p>
      {checkPermission('settings.manage') ? (
        <Link
          to="/settings?tab=modules"
          className="btn-primary inline-flex items-center rounded-md px-4 py-2 text-sm font-medium"
        >
          Open module settings
        </Link>
      ) : (
        <Link to="/dashboard" className="btn-primary inline-flex items-center rounded-md px-4 py-2 text-sm font-medium">
          Return to Dashboard
        </Link>
      )}
    </Centered>
  );
};

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredPermission,
  requiredAnyPermission,
  requiredRole,
  requiredModule,
  moduleLabel,
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
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div
            className="inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-red-600"
            role="status"
            aria-live="polite"
            aria-label="Loading"
          />
          <p className="text-theme-text-secondary mt-4" aria-live="polite">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  // If there's a stored token but user isn't loaded yet, show spinner
  // instead of redirecting. loadUser() will resolve this on the next render.
  if (!isAuthenticated && hasStoredToken && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div
            className="inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-red-600"
            role="status"
            aria-live="polite"
            aria-label="Loading"
          />
          <p className="text-theme-text-secondary mt-4" aria-live="polite">
            Loading...
          </p>
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

  // Force MFA enrollment when the organization requires it and the user has
  // not set it up yet (the backend enforces this too).
  if (user?.mfa_enrollment_required && !needsPasswordChange && location.pathname !== '/account') {
    return <Navigate to="/account" state={{ forceMfaSetup: true }} replace />;
  }

  // Check for required permission (single, AND) or any-of (OR)
  const lacksSingle = requiredPermission && !checkPermission(requiredPermission);
  const lacksAny =
    requiredAnyPermission && requiredAnyPermission.length > 0 && !requiredAnyPermission.some((p) => checkPermission(p));
  if (lacksSingle || lacksAny) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md text-center">
          <h2 className="text-theme-text-primary mb-4 text-2xl font-bold">Access Denied</h2>
          <p className="text-theme-text-secondary mb-6">
            You do not have the required permissions to access this page.
          </p>
          <Link
            to="/dashboard"
            className="btn-primary inline-flex items-center rounded-md px-4 py-2 text-sm font-medium"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Check for required role
  if (requiredRole && !hasRole(requiredRole)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md text-center">
          <h2 className="text-theme-text-primary mb-4 text-2xl font-bold">Access Denied</h2>
          <p className="text-theme-text-secondary mb-6">You do not have the required role to access this page.</p>
          <Link
            to="/dashboard"
            className="btn-primary inline-flex items-center rounded-md px-4 py-2 text-sm font-medium"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // User is authenticated and authorized
  if (requiredModule) {
    return (
      <ModuleGate module={requiredModule} label={moduleLabel}>
        {children}
      </ModuleGate>
    );
  }
  return <>{children}</>;
};
