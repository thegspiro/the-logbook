import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Pages
import Welcome from './pages/Welcome';
import OnboardingCheck from './pages/OnboardingCheck';
import DepartmentInfo from './pages/DepartmentInfo';

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Routes>
          {/* Welcome page - first thing users see */}
          <Route path="/" element={<Welcome />} />

          {/* Onboarding flow */}
          <Route path="/onboarding" element={<OnboardingCheck />} />

          {/* Onboarding wizard - Department Info */}
          <Route path="/onboarding/start" element={<DepartmentInfo />} />

          {/* Placeholder routes for future development */}
          <Route
            path="/onboarding/security-check"
            element={
              <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
                <div className="max-w-2xl w-full bg-white/10 backdrop-blur-sm rounded-lg p-8 text-center border border-white/20">
                  <h2 className="text-3xl font-bold text-white mb-4">
                    Security Check - Step 2
                  </h2>
                  <p className="text-slate-300 mb-6">
                    The remaining onboarding steps are under development. For
                    now, please use the API at{' '}
                    <a
                      href="/docs"
                      className="text-red-400 hover:text-red-300 underline"
                    >
                      /docs
                    </a>{' '}
                    to complete the setup.
                  </p>
                  <div className="text-left bg-slate-900/50 rounded-lg p-6 text-sm font-mono text-slate-300">
                    <p className="mb-2">Department Info Collected:</p>
                    <p className="mb-1">
                      • Name: {sessionStorage.getItem('departmentName') || 'Not set'}
                    </p>
                    <p className="mb-1">
                      • Logo: {sessionStorage.getItem('hasLogo') === 'true' ? 'Uploaded ✓' : 'Skipped'}
                    </p>
                    <p className="mt-4 mb-2">Next API Endpoints:</p>
                    <p className="mb-1">
                      • GET /api/v1/onboarding/security-check
                    </p>
                    <p className="mb-1">
                      • POST /api/v1/onboarding/organization
                    </p>
                    <p className="mb-1">
                      • POST /api/v1/onboarding/admin-user
                    </p>
                  </div>
                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={() => window.history.back()}
                      className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-all duration-300"
                    >
                      ← Go Back
                    </button>
                    <a
                      href={
                        import.meta.env.VITE_API_URL
                          ? `${import.meta.env.VITE_API_URL}/docs`
                          : 'http://localhost:3001/docs'
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold rounded-lg transition-all duration-300 text-center"
                    >
                      Open API Docs
                    </a>
                  </div>
                </div>
              </div>
            }
          />

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
