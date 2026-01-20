import React from 'react';
import { Route } from 'react-router-dom';
import {
  Welcome,
  OnboardingCheck,
  DepartmentInfo,
  NavigationChoice,
  EmailPlatformChoice,
  EmailConfiguration,
  FileStorageChoice,
  AuthenticationChoice,
  ITTeamBackupAccess,
  ModuleSelection,
  AdminUserCreation,
} from './pages';

/**
 * Onboarding Module Routes
 *
 * This component encapsulates all routes for the onboarding module.
 * To disable the onboarding module, simply remove or comment out
 * the OnboardingRoutes component in App.tsx.
 */
export const OnboardingRoutes: React.FC = () => {
  return (
    <>
      {/* Welcome page - first thing users see */}
      <Route path="/" element={<Welcome />} />

      {/* Onboarding flow */}
      <Route path="/onboarding" element={<OnboardingCheck />} />

      {/* Onboarding wizard - Department Info */}
      <Route path="/onboarding/start" element={<DepartmentInfo />} />

      {/* Onboarding wizard - Navigation Choice */}
      <Route path="/onboarding/navigation-choice" element={<NavigationChoice />} />

      {/* Onboarding wizard - Email Platform */}
      <Route path="/onboarding/email-platform" element={<EmailPlatformChoice />} />

      {/* Onboarding wizard - Email Configuration */}
      <Route path="/onboarding/email-config" element={<EmailConfiguration />} />

      {/* Onboarding wizard - File Storage Choice */}
      <Route path="/onboarding/file-storage" element={<FileStorageChoice />} />

      {/* Onboarding wizard - File Storage Configuration - Placeholder */}
      <Route
        path="/onboarding/file-storage-config"
        element={
          <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full bg-white/10 backdrop-blur-sm rounded-lg p-8 text-center border border-white/20">
              <h2 className="text-3xl font-bold text-white mb-4">
                File Storage Configuration
              </h2>
              <p className="text-slate-300 mb-6">
                File storage configuration page is under development.
              </p>
              <button
                onClick={() => window.location.href = '/onboarding/authentication'}
                className="px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold rounded-lg transition-all duration-300"
              >
                Continue to Authentication →
              </button>
            </div>
          </div>
        }
      />

      {/* Onboarding wizard - Authentication Choice */}
      <Route path="/onboarding/authentication" element={<AuthenticationChoice />} />

      {/* Onboarding wizard - IT Team & Backup Access */}
      <Route path="/onboarding/it-team" element={<ITTeamBackupAccess />} />

      {/* Onboarding wizard - Module Selection */}
      <Route path="/onboarding/module-selection" element={<ModuleSelection />} />

      {/* Onboarding wizard - Admin User Creation */}
      <Route path="/onboarding/admin-user" element={<AdminUserCreation />} />

      {/* Security Check - Placeholder */}
      <Route
        path="/onboarding/security-check"
        element={
          <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full bg-white/10 backdrop-blur-sm rounded-lg p-8 text-center border border-white/20">
              <h2 className="text-3xl font-bold text-white mb-4">
                Security Check - Step 2
              </h2>
              <p className="text-slate-300 mb-6">
                The remaining onboarding steps are under development. For now,
                please use the API at{' '}
                <a
                  href="/docs"
                  className="text-red-400 hover:text-red-300 underline"
                >
                  /docs
                </a>{' '}
                to complete the setup.
              </p>
              <div className="text-left bg-slate-900/50 rounded-lg p-6 text-sm font-mono text-slate-300">
                <p className="mb-2">Onboarding Info Collected:</p>
                <p className="mb-1">
                  • Department:{' '}
                  {sessionStorage.getItem('departmentName') || 'Not set'}
                </p>
                <p className="mb-1">
                  • Logo:{' '}
                  {sessionStorage.getItem('hasLogo') === 'true'
                    ? 'Uploaded ✓'
                    : 'Skipped'}
                </p>
                <p className="mb-1">
                  • Navigation:{' '}
                  {sessionStorage.getItem('navigationLayout') === 'top'
                    ? 'Top Bar'
                    : sessionStorage.getItem('navigationLayout') === 'left'
                    ? 'Left Sidebar'
                    : 'Not set'}
                </p>
                <p className="mb-1">
                  • Email: {sessionStorage.getItem('emailPlatform') || 'Not set'}
                </p>
                <p className="mt-4 mb-2">Next API Endpoints:</p>
                <p className="mb-1">• GET /api/v1/onboarding/security-check</p>
                <p className="mb-1">• POST /api/v1/onboarding/organization</p>
                <p className="mb-1">• POST /api/v1/onboarding/admin-user</p>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => window.history.back()}
                  className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-all duration-300"
                >
                  ← Go Back
                </button>
                <a
                  href={
                    import.meta.env.VITE_API_URL
                      ? `${import.meta.env.VITE_API_URL}/docs`
                      : 'http://localhost:3001/docs'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold rounded-lg transition-all duration-300 text-center"
                >
                  Open API Docs
                </a>
              </div>
            </div>
          </div>
        }
      />
    </>
  );
};
