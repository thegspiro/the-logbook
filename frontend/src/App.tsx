import { useEffect, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

// Security initialization
import { clearLegacySensitiveData } from "./modules/onboarding/utils/storage";

// Dynamic import retry/reload for stale chunks after deployments
import { lazyWithRetry, clearChunkReloadFlag } from "./utils/lazyWithRetry";

// Error Boundary
import { ErrorBoundary } from "./components/ErrorBoundary";

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
// Events Module
const EventsPage = lazyWithRetry(() =>
  import("./pages/EventsPage").then((m) => ({ default: m.EventsPage })),
);
const EventDetailPage = lazyWithRetry(() =>
  import("./pages/EventDetailPage").then((m) => ({
    default: m.EventDetailPage,
  })),
);
const EventQRCodePage = lazyWithRetry(() => import("./pages/EventQRCodePage"));
const EventSelfCheckInPage = lazyWithRetry(
  () => import("./pages/EventSelfCheckInPage"),
);
const EventCheckInMonitoringPage = lazyWithRetry(
  () => import("./pages/EventCheckInMonitoringPage"),
);
const EventEditPage = lazyWithRetry(() =>
  import("./pages/EventEditPage").then((m) => ({ default: m.EventEditPage })),
);
const EventsAdminHub = lazyWithRetry(() =>
  import("./pages/EventsAdminHub").then((m) => ({ default: m.EventsAdminHub })),
);

// Training Module
const TrainingAdminPage = lazyWithRetry(() =>
  import("./pages/TrainingAdminPage").then((m) => ({
    default: m.TrainingAdminPage,
  })),
);
const TrainingProgramsPage = lazyWithRetry(
  () => import("./pages/TrainingProgramsPage"),
);
const PipelineDetailPage = lazyWithRetry(
  () => import("./pages/PipelineDetailPage"),
);
const CourseLibraryPage = lazyWithRetry(
  () => import("./pages/CourseLibraryPage"),
);
const SubmitTrainingPage = lazyWithRetry(
  () => import("./pages/SubmitTrainingPage"),
);
const MyTrainingPage = lazyWithRetry(() => import("./pages/MyTrainingPage"));

// Skills Testing Module
const SkillsTestingPage = lazyWithRetry(() =>
  import("./pages/SkillsTestingPage").then((m) => ({
    default: m.SkillsTestingPage,
  })),
);
const SkillTemplateBuilderPage = lazyWithRetry(
  () => import("./pages/SkillTemplateBuilderPage"),
);
const StartSkillTestPage = lazyWithRetry(
  () => import("./pages/StartSkillTestPage"),
);
const ActiveSkillTestPage = lazyWithRetry(
  () => import("./pages/ActiveSkillTestPage"),
);

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
const PublicPortalAdmin = lazyWithRetry(
  () => import("./modules/public-portal/pages/PublicPortalAdmin"),
);

// Documents Module
const DocumentsPage = lazyWithRetry(() => import("./pages/DocumentsPage"));

// Inventory Module
const InventoryPage = lazyWithRetry(() => import("./pages/InventoryPage"));
const InventoryAdminHub = lazyWithRetry(() =>
  import("./pages/InventoryAdminHub").then((m) => ({
    default: m.InventoryAdminHub,
  })),
);
const InventoryCheckoutsPage = lazyWithRetry(
  () => import("./pages/InventoryCheckoutsPage"),
);
const MyEquipmentPage = lazyWithRetry(() => import("./pages/MyEquipmentPage"));
const StorageAreasPage = lazyWithRetry(
  () => import("./pages/StorageAreasPage"),
);

// Scheduling Module
const SchedulingPage = lazyWithRetry(() => import("./pages/SchedulingPage"));

// Facilities Module
const FacilitiesPage = lazyWithRetry(() => import("./pages/FacilitiesPage"));

// Locations (lightweight alternative when Facilities module is off)
const LocationsPage = lazyWithRetry(() => import("./pages/LocationsPage"));

// Public Location Kiosk Display (no auth required — for tablets in rooms)
const LocationKioskPage = lazyWithRetry(
  () => import("./pages/LocationKioskPage"),
);

// Apparatus Basic (lightweight alternative when Apparatus module is off)
const ApparatusBasicPage = lazyWithRetry(
  () => import("./pages/ApparatusBasicPage"),
);

// Elections Module
const ElectionsPage = lazyWithRetry(() =>
  import("./pages/ElectionsPage").then((m) => ({ default: m.ElectionsPage })),
);
const ElectionDetailPage = lazyWithRetry(() =>
  import("./pages/ElectionDetailPage").then((m) => ({
    default: m.ElectionDetailPage,
  })),
);
const BallotVotingPage = lazyWithRetry(
  () => import("./pages/BallotVotingPage"),
);

// Minutes Module
const MinutesPage = lazyWithRetry(() => import("./pages/MinutesPage"));
const MinutesDetailPage = lazyWithRetry(
  () => import("./pages/MinutesDetailPage"),
);

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

                  {/* Main Dashboard */}
                  <Route path="/dashboard" element={<Dashboard />} />

                  {/* Events Module - Member-facing */}
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/events/:id" element={<EventDetailPage />} />
                  <Route
                    path="/events/:id/qr-code"
                    element={<EventQRCodePage />}
                  />
                  <Route
                    path="/events/:id/check-in"
                    element={<EventSelfCheckInPage />}
                  />

                  {/* Events Module - Admin Hub */}
                  <Route
                    path="/events/admin"
                    element={
                      <ProtectedRoute requiredPermission="events.manage">
                        <EventsAdminHub />
                      </ProtectedRoute>
                    }
                  />

                  {/* Events Module - Per-event admin (stays as separate routes) */}
                  <Route
                    path="/events/:id/edit"
                    element={
                      <ProtectedRoute requiredPermission="events.manage">
                        <EventEditPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/events/:id/monitoring"
                    element={
                      <ProtectedRoute requiredPermission="events.manage">
                        <EventCheckInMonitoringPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/events/:id/analytics"
                    element={
                      <ProtectedRoute requiredPermission="analytics.view">
                        <AnalyticsDashboardPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Events Module - Legacy redirect */}
                  <Route
                    path="/events/new"
                    element={<Navigate to="/events/admin?tab=create" replace />}
                  />

                  {/* Documents Module */}
                  <Route path="/documents" element={<DocumentsPage />} />

                  {/* Training Module - Member-facing */}
                  <Route path="/training" element={<MyTrainingPage />} />
                  <Route
                    path="/training/my-training"
                    element={<MyTrainingPage />}
                  />
                  <Route
                    path="/training/submit"
                    element={<SubmitTrainingPage />}
                  />
                  <Route
                    path="/training/courses"
                    element={<CourseLibraryPage />}
                  />
                  <Route
                    path="/training/programs"
                    element={<TrainingProgramsPage />}
                  />
                  <Route
                    path="/training/programs/:programId"
                    element={<PipelineDetailPage />}
                  />

                  {/* Training Module - Admin Hub */}
                  <Route
                    path="/training/admin"
                    element={
                      <ProtectedRoute requiredPermission="training.manage">
                        <TrainingAdminPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Training Module - Legacy redirects to admin hub sub-pages */}
                  <Route
                    path="/training/officer"
                    element={
                      <Navigate
                        to="/training/admin?page=dashboard&tab=overview"
                        replace
                      />
                    }
                  />
                  <Route
                    path="/training/submissions"
                    element={
                      <Navigate
                        to="/training/admin?page=records&tab=submissions"
                        replace
                      />
                    }
                  />
                  <Route
                    path="/training/requirements"
                    element={
                      <Navigate
                        to="/training/admin?page=setup&tab=requirements"
                        replace
                      />
                    }
                  />
                  <Route
                    path="/training/sessions/new"
                    element={
                      <Navigate
                        to="/training/admin?page=records&tab=sessions"
                        replace
                      />
                    }
                  />
                  <Route
                    path="/training/programs/new"
                    element={
                      <Navigate
                        to="/training/admin?page=setup&tab=pipelines"
                        replace
                      />
                    }
                  />
                  <Route
                    path="/training/shift-reports"
                    element={
                      <Navigate
                        to="/training/admin?page=records&tab=shift-reports"
                        replace
                      />
                    }
                  />
                  <Route
                    path="/training/integrations"
                    element={
                      <Navigate
                        to="/training/admin?page=setup&tab=integrations"
                        replace
                      />
                    }
                  />

                  {/* Skills Testing Module — member-facing (available to all authenticated users) */}
                  <Route
                    path="/training/skills-testing"
                    element={<SkillsTestingPage />}
                  />
                  <Route
                    path="/training/skills-testing/templates/new"
                    element={
                      <ProtectedRoute requiredPermission="training.manage">
                        <SkillTemplateBuilderPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/training/skills-testing/templates/:id"
                    element={
                      <ProtectedRoute requiredPermission="training.manage">
                        <SkillTemplateBuilderPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/training/skills-testing/templates/:id/edit"
                    element={
                      <ProtectedRoute requiredPermission="training.manage">
                        <SkillTemplateBuilderPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/training/skills-testing/test/new"
                    element={<StartSkillTestPage />}
                  />
                  <Route
                    path="/training/skills-testing/test/:testId"
                    element={<ActiveSkillTestPage />}
                  />
                  <Route
                    path="/training/skills-testing/test/:testId/active"
                    element={<ActiveSkillTestPage />}
                  />

                  {/* Inventory Module */}
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route
                    path="/inventory/my-equipment"
                    element={<MyEquipmentPage />}
                  />
                  <Route
                    path="/inventory/admin"
                    element={
                      <ProtectedRoute requiredPermission="inventory.manage">
                        <InventoryAdminHub />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/inventory/checkouts"
                    element={
                      <ProtectedRoute requiredPermission="inventory.manage">
                        <InventoryCheckoutsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/inventory/storage-areas"
                    element={<StorageAreasPage />}
                  />

                  {/* Scheduling Module */}
                  <Route path="/scheduling" element={<SchedulingPage />} />

                  {/* Facilities Module (full) / Locations (lightweight) */}
                  <Route path="/facilities" element={<FacilitiesPage />} />
                  <Route path="/locations" element={<LocationsPage />} />

                  {/* Apparatus Basic (lightweight alternative when Apparatus module is off) */}
                  <Route
                    path="/apparatus-basic"
                    element={<ApparatusBasicPage />}
                  />

                  {/* Elections Module */}
                  <Route path="/elections" element={<ElectionsPage />} />
                  <Route
                    path="/elections/:electionId"
                    element={<ElectionDetailPage />}
                  />

                  {/* Minutes Module */}
                  <Route path="/minutes" element={<MinutesPage />} />
                  <Route
                    path="/minutes/:minutesId"
                    element={<MinutesDetailPage />}
                  />

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
                  <Route
                    path="/admin/public-portal"
                    element={
                      <ProtectedRoute requiredPermission="settings.manage">
                        <PublicPortalAdmin />
                      </ProtectedRoute>
                    }
                  />
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
                <Route path="/ballot" element={<BallotVotingPage />} />

                {/* Public Location Kiosk Display (no auth required — for tablets in rooms) */}
                <Route path="/display/:code" element={<LocationKioskPage />} />

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
