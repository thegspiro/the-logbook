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
import { RouteTitleManager } from './components/RouteTitleManager';

// Theme
import { ThemeProvider } from './contexts/ThemeContext';
import { PullToRefreshProvider } from './contexts/PullToRefreshContext';
import { ConfirmProvider } from './contexts/ConfirmContext';

// Protected Route & Layout
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout';

// Modules — each exports a get*Routes() function
import { getOnboardingRoutes } from './modules/onboarding';
import { getApparatusRoutes } from './modules/apparatus';
import { getMembershipRoutes } from './modules/membership';
import { getProspectiveMembersRoutes, getProspectiveMembersPublicRoutes } from './modules/prospective-members';
import { getAdminHoursRoutes } from './modules/admin-hours';
import { getCommunicationsRoutes } from './modules/communications';
import { getPublicPortalRoutes } from './modules/public-portal';
import { getSchedulingRoutes } from './modules/scheduling';
import { getEventsRoutes, getEventsPublicRoutes } from './modules/events';
import { getTrainingRoutes } from './modules/training';
import { getInventoryRoutes } from './modules/inventory';
import { getMedicalSuppliesRoutes } from './modules/medical-supplies';
import { getStorefrontRoutes } from './modules/storefront';
import { getElectionsRoutes, getElectionsPublicRoutes } from './modules/elections';
import { getMinutesRoutes } from './modules/minutes';
import { getFacilitiesRoutes, getFacilitiesPublicRoutes } from './modules/facilities';
import { getDocumentsRoutes } from './modules/documents';
import { getActionItemsRoutes } from './modules/action-items';
import { getGovernanceRoutes } from './modules/governance';
import { getNotificationsRoutes } from './modules/notifications';
import { getFormsRoutes, getFormsPublicRoutes } from './modules/forms';
import { getIntegrationsRoutes } from './modules/integrations';
import { getAdminRoutes } from './modules/admin';
import { getSettingsRoutes } from './modules/settings';
import { getReportsRoutes } from './modules/reports';
import { getGrantsFundraisingRoutes } from './modules/grants-fundraising';
import { getIPSecurityRoutes } from './modules/ip-security';
import { getFinanceRoutes } from './modules/finance';
import { getMedicalScreeningRoutes } from './modules/medical-screening';
import { getTestingRoutes } from './modules/testing';

// Loading fallback component
const PageLoadingFallback = () => (
  <main className="page-loading-fallback" aria-busy="true">
    <div className="text-center">
      <div className="page-loading-fallback__spinner" aria-hidden="true" />
      <p className="page-loading-fallback__message" role="status" aria-live="polite">
        Loading...
      </p>
    </div>
  </main>
);

// Critical pages - loaded immediately for fast initial navigation
import Dashboard from './pages/Dashboard';
import { LoginPage } from './pages/LoginPage';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage';

// Auth pages - loaded immediately for password reset flow
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { FinanceApprovalPage } from './pages/FinanceApprovalPage';

// Public legal pages (privacy policy / terms of service)
const LegalPage = lazyWithRetry(() => import('./pages/legal/LegalPage'));
const LearningCenterPage = lazyWithRetry(() => import('./pages/learning/LearningCenterPage'));
const LearningPathPage = lazyWithRetry(() => import('./pages/learning/LearningPathPage'));

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
            <RouteTitleManager />
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
                    <Route path="/learning/:pathId" element={<LearningPathPage />} />

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
                    {getMedicalSuppliesRoutes()}
                    {getStorefrontRoutes()}
                    {getSchedulingRoutes()}
                    {getFacilitiesRoutes()}
                    {getElectionsRoutes()}
                    {getMinutesRoutes()}
                    {getActionItemsRoutes()}
                    {getGovernanceRoutes()}
                    {getNotificationsRoutes()}
                    {getFormsRoutes()}
                    {getIntegrationsRoutes()}
                    {getMedicalScreeningRoutes()}
                    {getTestingRoutes()}

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
                containerClassName="app-toaster"
                toastOptions={{
                  duration: 4000,
                  className: 'app-toast',
                  ariaProps: {
                    role: 'status',
                    'aria-live': 'polite',
                  },
                  success: {
                    className: 'app-toast app-toast--success',
                    iconTheme: {
                      primary: 'var(--toast-success)',
                      secondary: 'var(--toast-icon-secondary)',
                    },
                  },
                  error: {
                    className: 'app-toast app-toast--error',
                    ariaProps: {
                      role: 'alert',
                      'aria-live': 'assertive',
                    },
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
