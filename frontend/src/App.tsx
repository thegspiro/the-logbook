import { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Security initialization
import { clearLegacySensitiveData } from './modules/onboarding/utils/storage';

// Dynamic import retry/reload for stale chunks after deployments
import { clearChunkReloadFlag } from './utils/lazyWithRetry';

// Error Boundary
import { ErrorBoundary } from './components/ErrorBoundary';

// Update notification — detects new deployments while the user is active
import { UpdateNotification } from './components/UpdateNotification';

// Theme
import { ThemeProvider } from './contexts/ThemeContext';

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
import { getElectionsRoutes, getElectionsPublicRoutes } from './modules/elections';
import { getMinutesRoutes } from './modules/minutes';
import { getFacilitiesRoutes, getFacilitiesPublicRoutes } from './modules/facilities';
import { getDocumentsRoutes } from './modules/documents';
import { getActionItemsRoutes } from './modules/action-items';
import { getNotificationsRoutes } from './modules/notifications';
import { getFormsRoutes, getFormsPublicRoutes } from './modules/forms';
import { getIntegrationsRoutes } from './modules/integrations';
import { getAdminRoutes } from './modules/admin';
import { getSettingsRoutes } from './modules/settings';
import { getReportsRoutes } from './modules/reports';
import { getGrantsFundraisingRoutes } from './modules/grants-fundraising';

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

// Critical pages - loaded immediately for fast initial navigation
import Dashboard from './pages/Dashboard';
import { LoginPage } from './pages/LoginPage';

// Auth pages - loaded immediately for password reset flow
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

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
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  {/* Main Dashboard */}
                  <Route path="/dashboard" element={<Dashboard />} />

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
                  {getSchedulingRoutes()}
                  {getFacilitiesRoutes()}
                  {getElectionsRoutes()}
                  {getMinutesRoutes()}
                  {getActionItemsRoutes()}
                  {getNotificationsRoutes()}
                  {getFormsRoutes()}
                  {getIntegrationsRoutes()}

                  {/* Grants & Fundraising */}
                  {getGrantsFundraisingRoutes()}

                  {/* Reports */}
                  {getReportsRoutes()}

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

                {/* Password Reset Pages */}
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />

                {/* Catch all - redirect to welcome */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>

            {/* Toast notifications */}
            <Toaster
              position="top-right"
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
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
