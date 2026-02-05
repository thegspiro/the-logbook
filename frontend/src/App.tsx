import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Security initialization
import { clearLegacySensitiveData } from './modules/onboarding/utils/storage';

// Modules
import { getOnboardingRoutes } from './modules/onboarding';
import { getApparatusRoutes } from './modules/apparatus';

// Pages
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import AddMember from './pages/AddMember';
import ImportMembers from './pages/ImportMembers';
import { MemberProfilePage } from './pages/MemberProfilePage';
import { MemberTrainingHistoryPage } from './pages/MemberTrainingHistoryPage';
import { EventsPage } from './pages/EventsPage';
import { EventDetailPage } from './pages/EventDetailPage';
import EventQRCodePage from './pages/EventQRCodePage';
import EventSelfCheckInPage from './pages/EventSelfCheckInPage';
import EventCheckInMonitoringPage from './pages/EventCheckInMonitoringPage';
import ErrorMonitoringPage from './pages/ErrorMonitoringPage';
import AnalyticsDashboardPage from './pages/AnalyticsDashboardPage';
import { RoleManagementPage } from './pages/RoleManagementPage';
import { SettingsPage } from './pages/SettingsPage';
import { MembersAdminPage } from './pages/MembersAdminPage';
import TrainingOfficerDashboard from './pages/TrainingOfficerDashboard';
import TrainingRequirementsPage from './pages/TrainingRequirementsPage';
import TrainingDashboardPage from './pages/TrainingDashboardPage';
import TrainingProgramsPage from './pages/TrainingProgramsPage';
import CreateTrainingSessionPage from './pages/CreateTrainingSessionPage';
import ExternalTrainingPage from './pages/ExternalTrainingPage';
import { LoginPage } from './pages/LoginPage';

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

          {/* Settings Module */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/roles" element={<RoleManagementPage />} />

          {/* Login Page */}
          <Route path="/login" element={<LoginPage />} />

          {/* Catch all - redirect to welcome */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

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
