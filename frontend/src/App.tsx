import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Security initialization
import { clearLegacySensitiveData } from './modules/onboarding/utils/storage';

// Error Boundary
import { ErrorBoundary } from './components/ErrorBoundary';

// Theme
import { ThemeProvider } from './contexts/ThemeContext';

// Protected Route & Layout
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout';

// Modules (keep these as they're router functions, not components)
import { getOnboardingRoutes } from './modules/onboarding';
import { getApparatusRoutes } from './modules/apparatus';
import { getMembershipRoutes } from './modules/membership';
import { getProspectiveMembersRoutes } from './modules/prospective-members';

// Loading fallback component
const PageLoadingFallback = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(to bottom right, var(--bg-gradient-from), var(--bg-gradient-via), var(--bg-gradient-to))' }}>
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-red-500 mb-4"></div>
      <p className="text-lg" style={{ color: 'var(--text-primary)' }}>Loading...</p>
    </div>
  </div>
);

// Critical pages - loaded immediately for fast initial navigation
import Dashboard from './pages/Dashboard';
import { LoginPage } from './pages/LoginPage';

// Auth pages - loaded immediately for password reset flow
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

// Lazy-loaded pages - loaded on demand for better initial load performance
// Events Module
const EventsPage = lazy(() => import('./pages/EventsPage').then(m => ({ default: m.EventsPage })));
const EventDetailPage = lazy(() => import('./pages/EventDetailPage').then(m => ({ default: m.EventDetailPage })));
const EventQRCodePage = lazy(() => import('./pages/EventQRCodePage'));
const EventSelfCheckInPage = lazy(() => import('./pages/EventSelfCheckInPage'));
const EventCheckInMonitoringPage = lazy(() => import('./pages/EventCheckInMonitoringPage'));
const EventEditPage = lazy(() => import('./pages/EventEditPage').then(m => ({ default: m.EventEditPage })));
const EventsAdminHub = lazy(() => import('./pages/EventsAdminHub').then(m => ({ default: m.EventsAdminHub })));

// Training Module
const TrainingDashboardPage = lazy(() => import('./pages/TrainingDashboardPage'));
const TrainingAdminPage = lazy(() => import('./pages/TrainingAdminPage').then(m => ({ default: m.TrainingAdminPage })));
const TrainingProgramsPage = lazy(() => import('./pages/TrainingProgramsPage'));
const PipelineDetailPage = lazy(() => import('./pages/PipelineDetailPage'));
const CourseLibraryPage = lazy(() => import('./pages/CourseLibraryPage'));
const SubmitTrainingPage = lazy(() => import('./pages/SubmitTrainingPage'));
const MyTrainingPage = lazy(() => import('./pages/MyTrainingPage'));

// Admin/Monitoring
const ErrorMonitoringPage = lazy(() => import('./pages/ErrorMonitoringPage'));
const AnalyticsDashboardPage = lazy(() => import('./pages/AnalyticsDashboardPage'));
const PublicPortalAdmin = lazy(() => import('./modules/public-portal/pages/PublicPortalAdmin'));

// Documents Module
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));

// Inventory Module
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const InventoryAdminHub = lazy(() => import('./pages/InventoryAdminHub').then(m => ({ default: m.InventoryAdminHub })));

// Scheduling Module
const SchedulingPage = lazy(() => import('./pages/SchedulingPage'));

// Elections Module
const ElectionsPage = lazy(() => import('./pages/ElectionsPage').then(m => ({ default: m.ElectionsPage })));
const ElectionDetailPage = lazy(() => import('./pages/ElectionDetailPage').then(m => ({ default: m.ElectionDetailPage })));
const BallotVotingPage = lazy(() => import('./pages/BallotVotingPage'));

// Minutes Module
const MinutesPage = lazy(() => import('./pages/MinutesPage'));
const MinutesDetailPage = lazy(() => import('./pages/MinutesDetailPage'));

// Notifications Module
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));

// Forms Module
const FormsPage = lazy(() => import('./pages/FormsPage'));
const PublicFormPage = lazy(() => import('./pages/PublicFormPage'));

// Integrations Module
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));

// Membership Pipeline Module
const MembershipPipelinePage = lazy(() => import('./pages/MembershipPipelinePage'));
const ProspectDetailPage = lazy(() => import('./pages/ProspectDetailPage'));
const PipelineSettingsPage = lazy(() => import('./pages/PipelineSettingsPage'));

// Settings & Reports
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const UserSettingsPage = lazy(() => import('./pages/UserSettingsPage').then(m => ({ default: m.UserSettingsPage })));
const RoleManagementPage = lazy(() => import('./pages/RoleManagementPage').then(m => ({ default: m.RoleManagementPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));

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
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              {/* Apparatus Module */}
              {getApparatusRoutes()}

              {/* Membership Module */}
              {getMembershipRoutes()}

              {/* Prospective Members Module */}
              {getProspectiveMembersRoutes()}

              {/* Main Dashboard */}
              <Route path="/dashboard" element={<Dashboard />} />

              {/* Events Module - Member-facing */}
              <Route path="/events" element={<EventsPage />} />
              <Route path="/events/:id" element={<EventDetailPage />} />
              <Route path="/events/:id/qr-code" element={<EventQRCodePage />} />
              <Route path="/events/:id/check-in" element={<EventSelfCheckInPage />} />

              {/* Events Module - Admin Hub */}
              <Route path="/events/admin" element={<ProtectedRoute requiredPermission="events.manage"><EventsAdminHub /></ProtectedRoute>} />

              {/* Events Module - Per-event admin (stays as separate routes) */}
              <Route path="/events/:id/edit" element={<ProtectedRoute requiredPermission="events.manage"><EventEditPage /></ProtectedRoute>} />
              <Route path="/events/:id/monitoring" element={<ProtectedRoute requiredPermission="events.manage"><EventCheckInMonitoringPage /></ProtectedRoute>} />
              <Route path="/events/:id/analytics" element={<ProtectedRoute requiredPermission="analytics.view"><AnalyticsDashboardPage /></ProtectedRoute>} />

              {/* Events Module - Legacy redirect */}
              <Route path="/events/new" element={<Navigate to="/events/admin?tab=create" replace />} />

              {/* Documents Module */}
              <Route path="/documents" element={<DocumentsPage />} />

              {/* Training Module - Member-facing */}
              <Route path="/training" element={<TrainingDashboardPage />} />
              <Route path="/training/my-training" element={<MyTrainingPage />} />
              <Route path="/training/submit" element={<SubmitTrainingPage />} />
              <Route path="/training/courses" element={<CourseLibraryPage />} />
              <Route path="/training/programs" element={<TrainingProgramsPage />} />
              <Route path="/training/programs/:programId" element={<PipelineDetailPage />} />

              {/* Training Module - Admin Hub */}
              <Route path="/training/admin" element={<ProtectedRoute requiredPermission="training.manage"><TrainingAdminPage /></ProtectedRoute>} />

              {/* Training Module - Legacy redirects to admin hub tabs */}
              <Route path="/training/officer" element={<Navigate to="/training/admin?tab=dashboard" replace />} />
              <Route path="/training/submissions" element={<Navigate to="/training/admin?tab=submissions" replace />} />
              <Route path="/training/requirements" element={<Navigate to="/training/admin?tab=requirements" replace />} />
              <Route path="/training/sessions/new" element={<Navigate to="/training/admin?tab=sessions" replace />} />
              <Route path="/training/programs/new" element={<Navigate to="/training/admin?tab=pipelines" replace />} />
              <Route path="/training/shift-reports" element={<Navigate to="/training/admin?tab=shift-reports" replace />} />
              <Route path="/training/integrations" element={<Navigate to="/training/admin?tab=integrations" replace />} />

              {/* Inventory Module */}
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/inventory/admin" element={<ProtectedRoute requiredPermission="inventory.manage"><InventoryAdminHub /></ProtectedRoute>} />

              {/* Scheduling Module */}
              <Route path="/scheduling" element={<SchedulingPage />} />

              {/* Elections Module */}
              <Route path="/elections" element={<ElectionsPage />} />
              <Route path="/elections/:id" element={<ElectionDetailPage />} />

              {/* Minutes Module */}
              <Route path="/minutes" element={<MinutesPage />} />
              <Route path="/minutes/:minutesId" element={<MinutesDetailPage />} />

              {/* Notifications Module */}
              <Route path="/notifications" element={<NotificationsPage />} />

              {/* Forms Module */}
              <Route path="/forms" element={<FormsPage />} />

              {/* Integrations Module */}
              <Route path="/integrations" element={<IntegrationsPage />} />

              {/* Admin/Monitoring Routes */}
              <Route path="/admin/errors" element={<ProtectedRoute requiredPermission="settings.manage"><ErrorMonitoringPage /></ProtectedRoute>} />
              <Route path="/admin/analytics" element={<ProtectedRoute requiredPermission="analytics.view"><AnalyticsDashboardPage /></ProtectedRoute>} />
              <Route path="/admin/public-portal" element={<ProtectedRoute requiredPermission="settings.manage"><PublicPortalAdmin /></ProtectedRoute>} />

              {/* Settings Module */}
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/account" element={<UserSettingsPage />} />
              <Route path="/settings/roles" element={<ProtectedRoute requiredPermission="roles.manage"><RoleManagementPage /></ProtectedRoute>} />

              {/* Reports */}
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            {/* Public Form Page (no auth required) */}
            <Route path="/f/:slug" element={<PublicFormPage />} />

            {/* Public Ballot Voting Page (token-based, no auth required) */}
            <Route path="/ballot" element={<BallotVotingPage />} />

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
              background: '#1e293b',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
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
