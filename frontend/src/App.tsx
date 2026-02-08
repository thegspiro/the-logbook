import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Security initialization
import { clearLegacySensitiveData } from './modules/onboarding/utils/storage';

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

// Settings
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const RoleManagementPage = lazy(() => import('./pages/RoleManagementPage').then(m => ({ default: m.RoleManagementPage })));

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
                APPARATUS MODULE
                Comment out the line below to disable apparatus
                ============================================ */}
            {getApparatusRoutes()}

            {/* ============================================
                MAIN APPLICATION ROUTES
                (After onboarding is complete)
                ============================================ */}

            {/* Main Dashboard - User lands here after onboarding */}
            <Route path="/dashboard" element={<Dashboard />} />

            {/* Membership Module */}
            <Route path="/members" element={<Members />} />
            <Route path="/members/add" element={<AddMember />} />
            <Route path="/members/import" element={<ImportMembers />} />
            <Route path="/members/:userId" element={<MemberProfilePage />} />
            <Route path="/members/:userId/training" element={<MemberTrainingHistoryPage />} />

            {/* Events Module */}
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/events/:id/qr-code" element={<EventQRCodePage />} />
            <Route path="/events/:id/check-in" element={<EventSelfCheckInPage />} />
            <Route path="/events/:id/monitoring" element={<EventCheckInMonitoringPage />} />
            <Route path="/events/:id/analytics" element={<AnalyticsDashboardPage />} />

            {/* Training Module */}
            <Route path="/training" element={<TrainingDashboardPage />} />
            <Route path="/training/officer" element={<TrainingOfficerDashboard />} />
            <Route path="/training/requirements" element={<TrainingRequirementsPage />} />
            <Route path="/training/programs" element={<TrainingProgramsPage />} />
            <Route path="/training/sessions/new" element={<CreateTrainingSessionPage />} />
            <Route path="/training/integrations" element={<ExternalTrainingPage />} />

            {/* Admin/Monitoring Routes */}
            <Route path="/admin/errors" element={<ErrorMonitoringPage />} />
            <Route path="/admin/analytics" element={<AnalyticsDashboardPage />} />
            <Route path="/admin/members" element={<MembersAdminPage />} />
            <Route path="/admin/public-portal" element={<PublicPortalAdmin />} />

            {/* Settings Module */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/roles" element={<RoleManagementPage />} />

            {/* Login Page */}
            <Route path="/login" element={<LoginPage />} />

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
  );
}

export default App;
