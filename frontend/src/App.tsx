import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Pages
import Welcome from './pages/Welcome';
import OnboardingCheck from './pages/OnboardingCheck';

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Routes>
          {/* Welcome page - first thing users see */}
          <Route path="/" element={<Welcome />} />

          {/* Onboarding flow */}
          <Route path="/onboarding" element={<OnboardingCheck />} />

          {/* Placeholder routes for future development */}
          <Route
            path="/onboarding/start"
            element={
              <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
                <div className="max-w-2xl w-full bg-white/10 backdrop-blur-sm rounded-lg p-8 text-center border border-white/20">
                  <h2 className="text-3xl font-bold text-white mb-4">
                    Onboarding Wizard
                  </h2>
                  <p className="text-slate-300 mb-6">
                    The onboarding wizard frontend is under development. For
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
                    <p className="mb-2">API Documentation:</p>
                    <p className="mb-1">
                      • GET /api/v1/onboarding/status - Check status
                    </p>
                    <p className="mb-1">
                      • POST /api/v1/onboarding/start - Start onboarding
                    </p>
                    <p className="mb-1">
                      • POST /api/v1/onboarding/organization - Create org
                    </p>
                    <p className="mb-1">
                      • POST /api/v1/onboarding/admin-user - Create admin
                    </p>
                    <p className="mb-1">
                      • POST /api/v1/onboarding/complete - Finish setup
                    </p>
                  </div>
                  <div className="mt-6">
                    <a
                      href={
                        import.meta.env.VITE_API_URL
                          ? `${import.meta.env.VITE_API_URL}/docs`
                          : 'http://localhost:3001/docs'
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold rounded-lg transition-all duration-300"
                    >
                      Open API Documentation
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
