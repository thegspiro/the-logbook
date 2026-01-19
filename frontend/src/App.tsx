import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Modules
import { OnboardingRoutes } from './modules/onboarding';

// Pages
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import AddMember from './pages/AddMember';
import ImportMembers from './pages/ImportMembers';

/**
 * Main Application Component
 *
 * To enable/disable modules:
 * - Onboarding: Comment out/uncomment <OnboardingRoutes /> below
 * - Future modules will follow the same pattern
 */
function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Routes>
          {/* ============================================
              ONBOARDING MODULE
              Comment out the line below to disable onboarding
              ============================================ */}
          <OnboardingRoutes />

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

          {/* Login Page */}
          <Route
            path="/login"
            element={
              <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white/10 backdrop-blur-sm rounded-lg p-8 text-center border border-white/20">
                  <h2 className="text-3xl font-bold text-white mb-4">
                    Login Page
                  </h2>
                  <p className="text-slate-300">
                    Login functionality is under development.
                  </p>
                </div>
              </div>
            }
          />

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
