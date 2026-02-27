import React from 'react';
import { Route, Navigate } from 'react-router-dom';
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
  PositionSetup,
  ModuleOverview,
  ModuleConfigTemplate,
  SystemOwnerCreation,
} from './pages';
import {
  FileStorageConfigPlaceholder,
  SecurityCheckPlaceholder,
} from './components/PlaceholderPages';

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

    {/* Onboarding wizard - Position Setup */}
    <Route path="/onboarding/positions" element={<PositionSetup />} />
    {/* Legacy route redirect for roles */}
    <Route path="/onboarding/roles" element={<Navigate to="/onboarding/positions" replace />} />

    {/* Onboarding wizard - Module Overview */}
    <Route path="/onboarding/modules" element={<ModuleOverview />} />

    {/* Module Configuration Pages */}
    <Route path="/onboarding/modules/:moduleId/config" element={<ModuleConfigTemplate />} />

    {/* Legacy route redirect */}
    <Route path="/onboarding/module-selection" element={<ModuleOverview />} />

    {/* Onboarding wizard - System Owner Creation */}
    <Route path="/onboarding/system-owner" element={<SystemOwnerCreation />} />
    {/* Legacy route redirect for admin-user */}
    <Route path="/onboarding/admin-user" element={<Navigate to="/onboarding/system-owner" replace />} />

    {/* Security Check - Placeholder */}
    <Route path="/onboarding/security-check" element={<SecurityCheckPlaceholder />} />
    </React.Fragment>
  );
};
