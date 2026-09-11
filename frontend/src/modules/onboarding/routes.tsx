import React from 'react';
import { Route, Navigate } from 'react-router';
import {
  Welcome,
  OnboardingCheck,
  OrganizationSetup,
  StationSetup,
  ApparatusSetup,
  NavigationChoice,
  EmailPlatformChoice,
  EmailConfiguration,
  FileStorageChoice,
  FileStorageConfiguration,
  AuthenticationChoice,
  ITTeamBackupAccess,
  PositionSetup,
  ModuleOverview,
  SystemOwnerCreation,
  SetupComplete,
  SetupPrerequisites,
} from './pages';
import { SecurityCheckPlaceholder } from './components/PlaceholderPages';

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

      {/* Pre-flight, not a step: nothing is collected or saved here. It says
          what the flow will ask for, so nobody starts and then leaves to go
          hunting for an SMTP password. */}
      <Route path="/onboarding/prepare" element={<SetupPrerequisites />} />

      {/* Step 1 - Organization Setup. Order lives in config/steps.ts. */}
      <Route path="/onboarding/start" element={<OrganizationSetup />} />

      {/* Legacy route redirect: the old department-info step is now folded into OrganizationSetup */}
      <Route path="/onboarding/department" element={<Navigate to="/onboarding/start" replace />} />

      {/* Stations beyond headquarters */}
      <Route path="/onboarding/stations" element={<StationSetup />} />

      {/* Apparatus */}
      <Route path="/onboarding/apparatus" element={<ApparatusSetup />} />

      {/* Navigation Choice - last step; a preference, not a prerequisite */}
      <Route path="/onboarding/navigation-choice" element={<NavigationChoice />} />

      {/* Onboarding wizard - Email Platform */}
      <Route path="/onboarding/email-platform" element={<EmailPlatformChoice />} />

      {/* Onboarding wizard - Email Configuration */}
      <Route path="/onboarding/email-config" element={<EmailConfiguration />} />

      {/* Onboarding wizard - File Storage Choice */}
      <Route path="/onboarding/file-storage" element={<FileStorageChoice />} />

      {/* Onboarding wizard - File Storage Configuration */}
      <Route path="/onboarding/file-storage-config" element={<FileStorageConfiguration />} />

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

      {/* Legacy route redirect: the per-module configuration step is gone. It
          collected manage positions into the wizard's store and submitted
          nothing; the Positions step, which now follows this one, owns that
          decision and saves it. Kept as a redirect because a restored session can still hold
          the old URL. */}
      <Route path="/onboarding/modules/:moduleId/config" element={<Navigate to="/onboarding/modules" replace />} />

      {/* Legacy route redirect */}
      <Route path="/onboarding/module-selection" element={<ModuleOverview />} />

      {/* Step 2 - System Owner Creation. Identity before the rest of setup. */}
      <Route path="/onboarding/system-owner" element={<SystemOwnerCreation />} />
      {/* Legacy route redirect for admin-user */}
      <Route path="/onboarding/admin-user" element={<Navigate to="/onboarding/system-owner" replace />} />

      {/* Onboarding wizard - final handoff into the department setup checklist */}
      <Route path="/onboarding/complete" element={<SetupComplete />} />

      {/* Security Check - Placeholder */}
      <Route path="/onboarding/security-check" element={<SecurityCheckPlaceholder />} />
    </React.Fragment>
  );
};
