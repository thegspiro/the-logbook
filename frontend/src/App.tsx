import { useEffect, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

// Security initialization
import { clearLegacySensitiveData } from "./modules/onboarding/utils/storage";

// Dynamic import retry/reload for stale chunks after deployments
import { lazyWithRetry, clearChunkReloadFlag } from "./utils/lazyWithRetry";

// Error Boundary
import { ErrorBoundary } from "./components/ErrorBoundary";

// Update notification — detects new deployments while the user is active
import { UpdateNotification } from "./components/UpdateNotification";

// Theme
import { ThemeProvider } from "./contexts/ThemeContext";

// Protected Route & Layout
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./components/layout";

// Modules (keep these as they're router functions, not components)
import { getOnboardingRoutes } from "./modules/onboarding";
import { getApparatusRoutes } from "./modules/apparatus";
import { getMembershipRoutes } from "./modules/membership";
import {
  getProspectiveMembersRoutes,
  getProspectiveMembersPublicRoutes,
} from "./modules/prospective-members";
import { getAdminHoursRoutes } from "./modules/admin-hours";
import { getCommunicationsRoutes } from "./modules/communications";
import { getPublicPortalRoutes } from "./modules/public-portal";
import { getSchedulingRoutes } from "./modules/scheduling";
import { getEventsRoutes } from "./modules/events";
import { getTrainingRoutes } from "./modules/training";
import { getInventoryRoutes } from "./modules/inventory";
import {
  getElectionsRoutes,
  getElectionsPublicRoutes,
} from "./modules/elections";
import { getMinutesRoutes } from "./modules/minutes";
import {
  getFacilitiesRoutes,
  getFacilitiesPublicRoutes,
} from "./modules/facilities";

// Loading fallback component
const PageLoadingFallback = () => (
  <div
    className="min-h-screen flex items-center justify-center"
    style={{
      background:
        "linear-gradient(to bottom right, var(--bg-gradient-from), var(--bg-gradient-via), var(--bg-gradient-to))",
    }}
  >
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-red-500 mb-4"></div>
      <p className="text-lg" style={{ color: "var(--text-primary)" }}>
        Loading...
      </p>
    </div>
  </div>
);

// Critical pages - loaded immediately for fast initial navigation
import Dashboard from "./pages/Dashboard";
import { LoginPage } from "./pages/LoginPage";

// Auth pages - loaded immediately for password reset flow
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";

// Lazy-loaded pages - loaded on demand for better initial load performance

// Training + Skills Testing moved to modules/training/routes.tsx

// Admin/Monitoring
const ErrorMonitoringPage = lazyWithRetry(
  () => import("./pages/ErrorMonitoringPage"),
);
const AnalyticsDashboardPage = lazyWithRetry(
  () => import("./pages/AnalyticsDashboardPage"),
);
const PlatformAnalyticsPage = lazyWithRetry(
  () => import("./pages/PlatformAnalyticsPage"),
);
// PublicPortalAdmin moved to modules/public-portal/routes.tsx

// Documents Module
const DocumentsPage = lazyWithRetry(() => import("./pages/DocumentsPage"));

// Inventory moved to modules/inventory/routes.tsx

// SchedulingPage moved to modules/scheduling/routes.tsx

// Facilities, Locations, Kiosk moved to modules/facilities/routes.tsx

// Elections, BallotVoting moved to modules/elections/routes.tsx

// Minutes moved to modules/minutes/routes.tsx

// Action Items (unified cross-module)
const ActionItemsPage = lazyWithRetry(() => import("./pages/ActionItemsPage"));

// Notifications Module
const NotificationsPage = lazyWithRetry(
  () => import("./pages/NotificationsPage"),
);

// Forms Module
const FormsPage = lazyWithRetry(() => import("./pages/FormsPage"));
const PublicFormPage = lazyWithRetry(() => import("./pages/PublicFormPage"));

// Public Event Request Status
const EventRequestStatusPage = lazyWithRetry(
  () => import("./pages/EventRequestStatusPage"),
);

// Integrations Module
const IntegrationsPage = lazyWithRetry(
  () => import("./pages/IntegrationsPage"),
);

// Settings & Reports
const SettingsPage = lazyWithRetry(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const UserSettingsPage = lazyWithRetry(() =>
  import("./pages/UserSettingsPage").then((m) => ({
    default: m.UserSettingsPage,
  })),
);
const RoleManagementPage = lazyWithRetry(() =>
  import("./pages/RoleManagementPage").then((m) => ({
    default: m.RoleManagementPage,
  })),
);
const ReportsPage = lazyWithRetry(() =>
  import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const DepartmentSetupPage = lazyWithRetry(
  () => import("./pages/DepartmentSetupPage"),
);

/**
 * Main Application Component
 *
 * To enable/disable modules:
 * - Onboarding: Comment out/uncomment <OnboardingRoutes /> below
 * - Future modules will follow the same pattern
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
                  {/* Apparatus Module */}
                  {getApparatusRoutes()}

                  {/* Membership Module */}
                  {getMembershipRoutes()}

                  {/* Prospective Members Module */}
                  {getProspectiveMembersRoutes()}

                  {/* Admin Hours Module */}
                  {getAdminHoursRoutes()}

                  {/* Communications Module */}
                  {getCommunicationsRoutes()}

                  {/* Main Dashboard */}
                  <Route path="/dashboard" element={<Dashboard />} />

                  {/* Events Module */}
                  {getEventsRoutes()}

                  {/* Documents Module */}
                  <Route path="/documents" element={<DocumentsPage />} />

                  {/* Training Module (includes Skills Testing) */}
                  {getTrainingRoutes()}

                  {/* Inventory Module */}
                  {getInventoryRoutes()}

                  {/* Scheduling Module */}
                  {getSchedulingRoutes()}

                  {/* Facilities Module (full) / Locations (lightweight) / Apparatus Basic */}
                  {getFacilitiesRoutes()}

                  {/* Elections Module */}
                  {getElectionsRoutes()}

                  {/* Minutes Module */}
                  {getMinutesRoutes()}

                  {/* Action Items (unified) */}
                  <Route path="/action-items" element={<ActionItemsPage />} />

                  {/* Notifications Module */}
                  <Route
                    path="/notifications"
                    element={<NotificationsPage />}
                  />

                  {/* Forms Module */}
                  <Route
                    path="/forms"
                    element={
                      <ProtectedRoute requiredPermission="settings.manage">
                        <FormsPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Integrations Module */}
                  <Route
                    path="/integrations"
                    element={
                      <ProtectedRoute requiredPermission="settings.manage">
                        <IntegrationsPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Admin/Monitoring Routes */}
                  <Route
                    path="/admin/errors"
                    element={
                      <ProtectedRoute requiredPermission="settings.manage">
                        <ErrorMonitoringPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/analytics"
                    element={
                      <ProtectedRoute requiredPermission="analytics.view">
                        <AnalyticsDashboardPage />
                      </ProtectedRoute>
                    }
                  />
                  {/* Public Portal Module */}
                  {getPublicPortalRoutes()}
                  <Route
                    path="/admin/platform-analytics"
                    element={
                      <ProtectedRoute requiredPermission="settings.manage">
                        <PlatformAnalyticsPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Settings Module */}
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute requiredPermission="settings.manage">
                        <SettingsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/settings/roles"
                    element={
                      <ProtectedRoute requiredPermission="positions.manage_permissions">
                        <RoleManagementPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/setup"
                    element={
                      <ProtectedRoute requiredPermission="settings.manage">
                        <DepartmentSetupPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* User Account Settings (accessible to all authenticated users) */}
                  <Route path="/account" element={<UserSettingsPage />} />
                  <Route
                    path="/settings/account"
                    element={<Navigate to="/account" replace />}
                  />

                  {/* Reports */}
                  <Route path="/reports" element={<ReportsPage />} />
                </Route>

                {/* Public Application Status (no auth required) */}
                {getProspectiveMembersPublicRoutes()}

                {/* Public Form Page (no auth required) */}
                <Route path="/f/:slug" element={<PublicFormPage />} />

                {/* Public Event Request Status (token-based, no auth required) */}
                <Route
                  path="/event-request/status/:token"
                  element={<EventRequestStatusPage />}
                />

                {/* Public Ballot Voting Page (token-based, no auth required) */}
                {getElectionsPublicRoutes()}

                {/* Public Location Kiosk Display (no auth required — for tablets in rooms) */}
                {getFacilitiesPublicRoutes()}

                {/* Login Page */}
                <Route path="/login" element={<LoginPage />} />

                {/* Password Reset Pages */}
                <Route
                  path="/forgot-password"
                  element={<ForgotPasswordPage />}
                />
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
                  background: "var(--surface-bg)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--surface-border)",
                },
                success: {
                  iconTheme: {
                    primary: "var(--toast-success)",
                    secondary: "var(--toast-icon-secondary)",
                  },
                },
                error: {
                  iconTheme: {
                    primary: "var(--toast-error)",
                    secondary: "var(--toast-icon-secondary)",
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
