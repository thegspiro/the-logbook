import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Security initialization
import { clearLegacySensitiveData } from './modules/onboarding/utils/storage';

// Error Boundary
import { ErrorBoundary } from './components/ErrorBoundary';

// Protected Route & Layout
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/layout';

// Modules (keep these as they're router functions, not components)
import { getOnboardingRoutes } from './modules/onboarding';
import { getApparatusRoutes } from './modules/apparatus';

// Loading fallback component
const PageLoadingFallback = () => (
  <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center">
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-red-500 mb-4"></div>
      <p className="text-white text-lg">Loading...</p>
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
// Membership Module
const Members = lazy(() => import('./pages/Members'));
const AddMember = lazy(() => import('./pages/AddMember'));
const ImportMembers = lazy(() => import('./pages/ImportMembers'));
const MemberProfilePage = lazy(() => import('./pages/MemberProfilePage').then(m => ({ default: m.MemberProfilePage })));
const MemberTrainingHistoryPage = lazy(() => import('./pages/MemberTrainingHistoryPage').then(m => ({ default: m.MemberTrainingHistoryPage })));

// Events Module
const EventsPage = lazy(() => import('./pages/EventsPage').then(m => ({ default: m.EventsPage })));
const EventDetailPage = lazy(() => import('./pages/EventDetailPage').then(m => ({ default: m.EventDetailPage })));
const EventQRCodePage = lazy(() => import('./pages/EventQRCodePage'));
const EventSelfCheckInPage = lazy(() => import('./pages/EventSelfCheckInPage'));
const EventCheckInMonitoringPage = lazy(() => import('./pages/EventCheckInMonitoringPage'));

// Training Module
const TrainingDashboardPage = lazy(() => import('./pages/TrainingDashboardPage'));
const TrainingOfficerDashboard = lazy(() => import('./pages/TrainingOfficerDashboard'));
const TrainingRequirementsPage = lazy(() => import('./pages/TrainingRequirementsPage'));
const TrainingProgramsPage = lazy(() => import('./pages/TrainingProgramsPage'));
const CreateTrainingSessionPage = lazy(() => import('./pages/CreateTrainingSessionPage'));
const ExternalTrainingPage = lazy(() => import('./pages/ExternalTrainingPage'));

// Admin/Monitoring
const ErrorMonitoringPage = lazy(() => import('./pages/ErrorMonitoringPage'));
const AnalyticsDashboardPage = lazy(() => import('./pages/AnalyticsDashboardPage'));
const MembersAdminPage = lazy(() => import('./pages/MembersAdminPage').then(m => ({ default: m.MembersAdminPage })));
const PublicPortalAdmin = lazy(() => import('./modules/public-portal/pages/PublicPortalAdmin'));

// Documents Module
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));

// Inventory Module
const InventoryPage = lazy(() => import('./pages/InventoryPage'));

// Scheduling Module
const SchedulingPage = lazy(() => import('./pages/SchedulingPage'));

// Elections Module
const ElectionsPage = lazy(() => import('./pages/ElectionsPage').then(m => ({ default: m.ElectionsPage })));
const ElectionDetailPage = lazy(() => import('./pages/ElectionDetailPage').then(m => ({ default: m.ElectionDetailPage })));

// Minutes Module
const MinutesPage = lazy(() => import('./pages/MinutesPage'));

// Notifications Module
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));

// Forms Module
const FormsPage = lazy(() => import('./pages/FormsPage'));

// Integrations Module
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));

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

              {/* Main Dashboard */}
              <Route path="/dashboard" element={<Dashboard />} />

              {/* Membership Module */}
              <Route path="/members" element={<Members />} />
              <Route path="/members/add" element={<ProtectedRoute requiredPermission="members.create"><AddMember /></ProtectedRoute>} />
              <Route path="/members/import" element={<ProtectedRoute requiredPermission="members.create"><ImportMembers /></ProtectedRoute>} />
              <Route path="/members/:userId" element={<MemberProfilePage />} />
              <Route path="/members/:userId/training" element={<MemberTrainingHistoryPage />} />

              {/* Events Module */}
              <Route path="/events" element={<EventsPage />} />
              <Route path="/events/:id" element={<EventDetailPage />} />
              <Route path="/events/:id/qr-code" element={<EventQRCodePage />} />
              <Route path="/events/:id/check-in" element={<EventSelfCheckInPage />} />
              <Route path="/events/:id/monitoring" element={<ProtectedRoute requiredPermission="events.manage"><EventCheckInMonitoringPage /></ProtectedRoute>} />
              <Route path="/events/:id/analytics" element={<ProtectedRoute requiredPermission="analytics.view"><AnalyticsDashboardPage /></ProtectedRoute>} />

              {/* Documents Module */}
              <Route path="/documents" element={<DocumentsPage />} />

              {/* Training Module */}
              <Route path="/training" element={<TrainingDashboardPage />} />
              <Route path="/training/officer" element={<ProtectedRoute requiredPermission="training.manage"><TrainingOfficerDashboard /></ProtectedRoute>} />
              <Route path="/training/requirements" element={<ProtectedRoute requiredPermission="training.manage"><TrainingRequirementsPage /></ProtectedRoute>} />
              <Route path="/training/programs" element={<TrainingProgramsPage />} />
              <Route path="/training/sessions/new" element={<ProtectedRoute requiredPermission="training.manage"><CreateTrainingSessionPage /></ProtectedRoute>} />
              <Route path="/training/integrations" element={<ProtectedRoute requiredPermission="training.manage"><ExternalTrainingPage /></ProtectedRoute>} />

              {/* Inventory Module */}
              <Route path="/inventory" element={<InventoryPage />} />

              {/* Scheduling Module */}
              <Route path="/scheduling" element={<SchedulingPage />} />

              {/* Elections Module */}
              <Route path="/elections" element={<ElectionsPage />} />
              <Route path="/elections/:id" element={<ElectionDetailPage />} />

              {/* Minutes Module */}
              <Route path="/minutes" element={<MinutesPage />} />

              {/* Notifications Module */}
              <Route path="/notifications" element={<NotificationsPage />} />

              {/* Forms Module */}
              <Route path="/forms" element={<FormsPage />} />

              {/* Integrations Module */}
              <Route path="/integrations" element={<IntegrationsPage />} />

              {/* Admin/Monitoring Routes */}
              <Route path="/admin/errors" element={<ProtectedRoute requiredPermission="admin.errors"><ErrorMonitoringPage /></ProtectedRoute>} />
              <Route path="/admin/analytics" element={<ProtectedRoute requiredPermission="analytics.view"><AnalyticsDashboardPage /></ProtectedRoute>} />
              <Route path="/admin/members" element={<ProtectedRoute requiredPermission="members.manage"><MembersAdminPage /></ProtectedRoute>} />
              <Route path="/admin/public-portal" element={<ProtectedRoute requiredPermission="admin.settings"><PublicPortalAdmin /></ProtectedRoute>} />

              {/* Settings Module */}
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/account" element={<UserSettingsPage />} />
              <Route path="/settings/roles" element={<ProtectedRoute requiredPermission="roles.manage"><RoleManagementPage /></ProtectedRoute>} />

              {/* Reports */}
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

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
  );
}

export default App;
