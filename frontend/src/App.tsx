import { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { Toaster } from 'react-hot-toast';

// Security initialization
import { clearLegacySensitiveData } from './modules/onboarding/utils/storage';

// Dynamic import retry/reload for stale chunks after deployments
import { clearChunkReloadFlag, lazyWithRetry } from './utils/lazyWithRetry';

// Error Boundary
import { ErrorBoundary } from './components/ErrorBoundary';

// Update notification — detects new deployments while the user is active
import { UpdateNotification } from './components/UpdateNotification';

// Theme
import { ThemeProvider } from './contexts/ThemeContext';
import { PullToRefreshProvider } from './contexts/PullToRefreshContext';
import { ConfirmProvider } from './contexts/ConfirmContext';

// Protected Route & Layout
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout';

// Modules — each exports a get*Routes() function
import { getOnboardingRoutes } from './modules/onboarding/routes';
import { getApparatusRoutes } from './modules/apparatus/routes';
import { getMembershipRoutes } from './modules/membership/routes';
import { getProspectiveMembersRoutes, getProspectiveMembersPublicRoutes } from './modules/prospective-members/routes';
import { getAdminHoursRoutes } from './modules/admin-hours/routes';
import { getCommunicationsRoutes } from './modules/communications/routes';
import { getPublicPortalRoutes } from './modules/public-portal/routes';
import { getSchedulingRoutes } from './modules/scheduling/routes';
import { getEventsRoutes, getEventsPublicRoutes } from './modules/events/routes';
import { getTrainingRoutes } from './modules/training/routes';
import { getInventoryRoutes } from './modules/inventory/routes';
import { getStorefrontRoutes } from './modules/storefront/routes';
import { getElectionsRoutes, getElectionsPublicRoutes } from './modules/elections/routes';
import { getMinutesRoutes } from './modules/minutes/routes';
import { getFacilitiesRoutes, getFacilitiesPublicRoutes } from './modules/facilities/routes';
import { getDocumentsRoutes } from './modules/documents/routes';
import { getActionItemsRoutes } from './modules/action-items/routes';
import { getNotificationsRoutes } from './modules/notifications/routes';
import { getFormsRoutes, getFormsPublicRoutes } from './modules/forms/routes';
import { getIntegrationsRoutes } from './modules/integrations/routes';
import { getAdminRoutes } from './modules/admin/routes';
import { getSettingsRoutes } from './modules/settings/routes';
import { getReportsRoutes } from './modules/reports/routes';
import { getGrantsFundraisingRoutes } from './modules/grants-fundraising/routes';
import { getIPSecurityRoutes } from './modules/ip-security/routes';
import { getFinanceRoutes } from './modules/finance/routes';
import { getMedicalScreeningRoutes } from './modules/medical-screening/routes';

// Loading fallback component
const PageLoadingFallback = () => (
  <div
    className="flex min-h-screen items-center justify-center"
    style={{
      background:
        'linear-gradient(to bottom right, var(--bg-gradient-from), var(--bg-gradient-via), var(--bg-gradient-to))',
    }}
  >
    <div className="text-center">
      <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-t-4 border-b-4 border-red-500"></div>
      <p className="text-lg" style={{ color: 'var(--text-primary)' }}>
        Loading...
      </p>
    </div>
  </div>
);

// Authentication pages stay in the shell; the dashboard is large enough to
// delay login/reset first paint and is loaded only after session routing.
import { LoginPage } from './pages/LoginPage';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage';

// Auth pages - loaded immediately for password reset flow
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { FinanceApprovalPage } from './pages/FinanceApprovalPage';

// Public legal pages (privacy policy / terms of service)
const LegalPage = lazyWithRetry(() => import('./pages/legal/LegalPage'));
const LearningCenterPage = lazyWithRetry(() => import('./pages/LearningCenterPage'));
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));

/**
 * Main Application Component
 *
 * To enable/disable modules, comment out or remove the corresponding
 * get*Routes() call below. Each module is self-contained and can be
 * toggled independently.
 */
function App() {
  // Security: Clear any legacy sensitive data on app initialization
  useEffect(() => {
    clearLegacySensitiveData();
    clearChunkReloadFlag();
  }, []);

  return (
    <ThemeProvider>
      <ErrorBoundary>
        {/* Above the router so any screen can ask for a confirmation, and
            outside AppLayout so public pages (login, onboarding) get one too. */}
        <ConfirmProvider>
          <BrowserRouter>
            <div className="App">
              <UpdateNotification />
              <Suspense fallback={<PageLoadingFallback />}>
                <Routes>
                  {/* ============================================
                ONBOARDING MODULE
                Comment out the line below to disable onboarding
                ============================================ */}
                  {getOnboardingRoutes()}

                  {/* ============================================
                PROTECTED ROUTES WITH APP LAYOUT
                All routes below get the sidebar/top navigation
                ============================================ */}
                  <Route
                    element={
                      <ProtectedRoute>
                        <PullToRefreshProvider>
                          <AppLayout />
                        </PullToRefreshProvider>
                      </ProtectedRoute>
                    }
                  >
                    {/* Main Dashboard */}
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/learning" element={<LearningCenterPage />} />

                    {/* Feature Modules */}
                    {getApparatusRoutes()}
                    {getMembershipRoutes()}
                    {getProspectiveMembersRoutes()}
                    {getAdminHoursRoutes()}
                    {getCommunicationsRoutes()}
                    {getEventsRoutes()}
                    {getDocumentsRoutes()}
                    {getTrainingRoutes()}
                    {getInventoryRoutes()}
                    {getStorefrontRoutes()}
                    {getSchedulingRoutes()}
                    {getFacilitiesRoutes()}
                    {getElectionsRoutes()}
                    {getMinutesRoutes()}
                    {getActionItemsRoutes()}
                    {getNotificationsRoutes()}
                    {getFormsRoutes()}
                    {getIntegrationsRoutes()}
                    {getMedicalScreeningRoutes()}

                    {/* Finance */}
                    {getFinanceRoutes()}

                    {/* Grants & Fundraising */}
                    {getGrantsFundraisingRoutes()}

                    {/* Reports */}
                    {getReportsRoutes()}

                    {/* IP Security */}
                    {getIPSecurityRoutes()}

                    {/* Admin & Settings */}
                    {getAdminRoutes()}
                    {getPublicPortalRoutes()}
                    {getSettingsRoutes()}
                  </Route>

                  {/* ============================================
                PUBLIC ROUTES (no auth required)
                ============================================ */}
                  {getProspectiveMembersPublicRoutes()}
                  {getFormsPublicRoutes()}
                  {getEventsPublicRoutes()}
                  {getElectionsPublicRoutes()}
                  {getFacilitiesPublicRoutes()}

                  {/* Login Page */}
                  <Route path="/login" element={<LoginPage />} />

                  {/* OAuth (Google) redirect landing page */}
                  <Route path="/auth/callback" element={<OAuthCallbackPage />} />

                  {/* Password Reset Pages */}
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />

                  {/* Legal pages (public) */}
                  <Route path="/privacy" element={<LegalPage />} />
                  <Route path="/terms" element={<LegalPage />} />
                  {/* Public external-approver page (token-authenticated) */}
                  <Route path="/finance/approvals/:token" element={<FinanceApprovalPage />} />

                  {/* Catch all - redirect to welcome */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>

              {/* Toast notifications */}
              <Toaster
                position="top-right"
                containerStyle={{ top: 'calc(0.5rem + env(safe-area-inset-top))' }}
                toastOptions={{
                  duration: 4000,
                  style: {
                    background: 'var(--surface-bg)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--surface-border)',
                  },
                  success: {
                    iconTheme: {
                      primary: 'var(--toast-success)',
                      secondary: 'var(--toast-icon-secondary)',
                    },
                  },
                  error: {
                    iconTheme: {
                      primary: 'var(--toast-error)',
                      secondary: 'var(--toast-icon-secondary)',
                    },
                  },
                }}
              />
            </div>
          </BrowserRouter>
        </ConfirmProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
