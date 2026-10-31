import { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import { Toaster } from 'react-hot-toast';

// Security initialization
import { clearLegacySensitiveData } from './modules/onboarding/utils/storage';

// Dynamic import retry/reload for stale chunks after deployments
import { lazyWithRetry } from './utils/lazyWithRetry';

// Error Boundary
import { ErrorBoundary } from './components/ErrorBoundary';

// Update notification — detects new deployments while the user is active
import { UpdateNotification } from './components/UpdateNotification';
import { RouteTitleManager } from './components/RouteTitleManager';

// Theme
import { ThemeProvider } from './contexts/ThemeContext';
import { PullToRefreshProvider } from './contexts/PullToRefreshContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { StepUpProvider } from './contexts/StepUpContext';
import { SignOutUnconfirmedNotice } from './components/SignOutUnconfirmedNotice';

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
import { getMedicalSuppliesRoutes } from './modules/medical-supplies/routes';
import { getStorefrontRoutes } from './modules/storefront/routes';
import { getElectionsRoutes, getElectionsPublicRoutes } from './modules/elections/routes';
import { getMinutesRoutes } from './modules/minutes/routes';
import { getFacilitiesRoutes, getFacilitiesPublicRoutes } from './modules/facilities/routes';
import { getDocumentsRoutes } from './modules/documents/routes';
import { getActionItemsRoutes } from './modules/action-items/routes';
import { getGovernanceRoutes } from './modules/governance/routes';
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
import { getTestingRoutes } from './modules/testing/routes';

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

const PublicMinutesPage = lazyWithRetry(() => import('./pages/PublicMinutesPage'));
// Public legal pages (privacy policy / terms of service)
const LegalPage = lazyWithRetry(() => import('./pages/legal/LegalPage'));
const LearningCenterPage = lazyWithRetry(() => import('./pages/learning/LearningCenterPage'));
const NotFoundPage = lazyWithRetry(() => import('./pages/NotFoundPage'));
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
  }, []);

  return (
    <ThemeProvider>
      <ErrorBoundary>
        {/* Above the router so any screen can ask for a confirmation, and
            outside AppLayout so public pages (login, onboarding) get one too. */}
        <ConfirmProvider>
          <StepUpProvider>
            <BrowserRouter>
              <RouteTitleManager />
              <div className="App">
                <UpdateNotification />
                <SignOutUnconfirmedNotice />
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

                      {/* Anything above that matched nothing. Inside the layout so a
                        signed-in user keeps the navigation, and a signed-out one is
                        sent to sign in first. */}
                      <Route path="*" element={<NotFoundPage />} />
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
                    {/* Public minutes (no sign-in): the copies the department chose to post */}
                    <Route path="/public/minutes" element={<PublicMinutesPage />} />
                    <Route path="/public/minutes/:copyId" element={<PublicMinutesPage />} />
                    {/* Public external-approver page (token-authenticated) */}
                    <Route path="/finance/approvals/:token" element={<FinanceApprovalPage />} />
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
          </StepUpProvider>
        </ConfirmProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
