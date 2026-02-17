import React from 'react';
import { Route, useNavigate, Navigate } from 'react-router-dom';
import {
  Welcome,
  OnboardingCheck,
  OrganizationSetup,
  NavigationChoice,
  EmailPlatformChoice,
  EmailConfiguration,
  FileStorageChoice,
  AuthenticationChoice,
  ITTeamBackupAccess,
  RoleSetup,
  ModuleOverview,
  ModuleConfigTemplate,
  AdminUserCreation,
} from './pages';
import { useOnboardingStore } from './store';

/**
 * File Storage Config Placeholder Component
 * Skips detailed configuration for now - can be configured later in settings
 */
const FileStorageConfigPlaceholder: React.FC = () => {
  const navigate = useNavigate();
  const storedPlatform = useOnboardingStore(state => state.fileStoragePlatform);
  const platform = storedPlatform || 'local';

  // Auto-redirect after a brief moment to show the user what happened
  React.useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/onboarding/authentication');
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-theme-surface backdrop-blur-sm rounded-lg p-8 text-center border border-theme-surface-border">
        <div className="text-green-400 text-5xl mb-4">✓</div>
        <h2 className="text-3xl font-bold text-theme-text-primary mb-4">
          File Storage Selected
        </h2>
        <p className="text-theme-text-secondary mb-2">
          You selected: <span className="text-theme-text-primary font-semibold capitalize">{platform.replace('_', ' ')}</span>
        </p>
        <p className="text-theme-text-muted text-sm mb-6">
          Detailed configuration can be done later in Settings → File Storage.
        </p>
        <div className="flex items-center justify-center gap-2 text-theme-text-muted">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></span>
          <span>Continuing to authentication...</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Security Check Placeholder Component
 * This route is not part of the main onboarding flow - redirects to modules
 */
const SecurityCheckPlaceholder: React.FC = () => {
  const navigate = useNavigate();

  // Auto-redirect to modules page since this isn't in the main flow
  React.useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/onboarding/modules');
    }, 1500);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-theme-surface backdrop-blur-sm rounded-lg p-8 text-center border border-theme-surface-border">
        <div className="text-blue-400 text-5xl mb-4">🔒</div>
        <h2 className="text-3xl font-bold text-theme-text-primary mb-4">
          Security Configuration
        </h2>
        <p className="text-theme-text-secondary mb-6">
          Security settings will be configured automatically based on your authentication choice.
          You can customize security options later in Settings → Security.
        </p>
        <div className="flex items-center justify-center gap-2 text-theme-text-muted">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></span>
          <span>Redirecting to module selection...</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Onboarding Module Routes
 *
 * This function returns route elements for the onboarding module.
 * To disable the onboarding module, simply remove or comment out
 * the call to this function in App.tsx.
 */
export const getOnboardingRoutes = () => {
  return (
    <React.Fragment>
    {/* Welcome page - first thing users see */}
    <Route path="/" element={<Welcome />} />

    {/* Onboarding flow */}
    <Route path="/onboarding" element={<OnboardingCheck />} />

    {/* Onboarding wizard - Step 1: Organization Setup (comprehensive) */}
    <Route path="/onboarding/start" element={<OrganizationSetup />} />

    {/* Legacy route redirect for DepartmentInfo */}
    <Route path="/onboarding/department" element={<Navigate to="/onboarding/start" replace />} />

    {/* Onboarding wizard - Step 2: Navigation Choice */}
    <Route path="/onboarding/navigation-choice" element={<NavigationChoice />} />

    {/* Onboarding wizard - Email Platform */}
    <Route path="/onboarding/email-platform" element={<EmailPlatformChoice />} />

    {/* Onboarding wizard - Email Configuration */}
    <Route path="/onboarding/email-config" element={<EmailConfiguration />} />

    {/* Onboarding wizard - File Storage Choice */}
    <Route path="/onboarding/file-storage" element={<FileStorageChoice />} />

    {/* Onboarding wizard - File Storage Configuration - Placeholder */}
    <Route path="/onboarding/file-storage-config" element={<FileStorageConfigPlaceholder />} />

    {/* Onboarding wizard - Authentication Choice */}
    <Route path="/onboarding/authentication" element={<AuthenticationChoice />} />

    {/* Onboarding wizard - IT Team & Backup Access */}
    <Route path="/onboarding/it-team" element={<ITTeamBackupAccess />} />

    {/* Onboarding wizard - Role Setup */}
    <Route path="/onboarding/roles" element={<RoleSetup />} />

    {/* Onboarding wizard - Module Overview */}
    <Route path="/onboarding/modules" element={<ModuleOverview />} />

    {/* Module Configuration Pages */}
    <Route path="/onboarding/modules/:moduleId/config" element={<ModuleConfigTemplate />} />

    {/* Legacy route redirect */}
    <Route path="/onboarding/module-selection" element={<ModuleOverview />} />

    {/* Onboarding wizard - Admin User Creation */}
    <Route path="/onboarding/admin-user" element={<AdminUserCreation />} />

    {/* Security Check - Placeholder */}
    <Route path="/onboarding/security-check" element={<SecurityCheckPlaceholder />} />
    </React.Fragment>
  );
};
