import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ThemeToggle } from '../components';

const Welcome: React.FC = () => {
  const [showTitle, setShowTitle] = useState(false);
  const [showParagraph, setShowParagraph] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // If the user is already authenticated, go straight to the dashboard
    if (localStorage.getItem('has_session')) {
      void navigate('/dashboard', { replace: true });
      return;
    }

    // Check if onboarding has already been completed by looking for an
    // existing organization.  If one exists, the user should log in
    // rather than seeing the "Get Started" onboarding splash.
    const checkOnboardingStatus = async () => {
      try {
        const response = await fetch('/api/v1/auth/branding');
        if (response.ok) {
          const data: unknown = await response.json();
          if (data && typeof data === 'object' && 'name' in data && data.name) {
            // Organization exists → onboarding is done → go to login
            void navigate('/login', { replace: true });
            return;
          }
        }
      } catch {
        // Backend not reachable yet — show the Welcome page normally
      }
      setChecking(false);
    };

    void checkOnboardingStatus();
  }, [navigate]);

  useEffect(() => {
    if (checking) return;

    // Show title quickly so the user isn't staring at a blank screen
    const titleTimer = setTimeout(() => {
      setShowTitle(true);
    }, 300);

    // Show paragraph shortly after title
    const paragraphTimer = setTimeout(() => {
      setShowParagraph(true);
    }, 800);

    return () => {
      clearTimeout(titleTimer);
      clearTimeout(paragraphTimer);
    };
  }, [checking]);

  // Show a brief loading state while we check onboarding status
  if (checking) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4">
        <div className="text-center">
          <div className="border-theme-accent-red mb-4 inline-block h-12 w-12 animate-spin rounded-full border-t-4 border-b-4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to relative flex min-h-screen items-center justify-center bg-linear-to-br p-4">
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="w-full max-w-3xl space-y-8 text-center">
        {/* Title */}
        <h1
          className={`text-theme-text-primary text-6xl font-bold transition-all duration-1000 md:text-7xl ${
            showTitle ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
          }`}
        >
          Welcome to{' '}
          <span className="bg-linear-to-r from-red-400 to-orange-500 bg-clip-text text-transparent">The Logbook</span>
        </h1>

        {/* Paragraph */}
        <div
          className={`transition-all delay-300 duration-1000 ${
            showParagraph ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
          }`}
        >
          <p className="text-theme-text-secondary text-xl leading-relaxed md:text-2xl">
            A secure department intranet built by a local volunteer fire department and shared with the world to help
            other volunteer departments manage their operations, training, and community service. Designed with HIPAA
            requirements in mind.
          </p>

          {/* Badge indicators */}
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
            <span className="bg-theme-surface text-theme-text-secondary border-theme-surface-border rounded-full border px-4 py-2 backdrop-blur-xs">
              HIPAA-Oriented Security
            </span>
            <span className="bg-theme-surface text-theme-text-secondary border-theme-surface-border rounded-full border px-4 py-2 backdrop-blur-xs">
              Section 508 Accessible
            </span>
            <span className="bg-theme-surface text-theme-text-secondary border-theme-surface-border rounded-full border px-4 py-2 backdrop-blur-xs">
              Zero Plain Text Passwords
            </span>
            <span className="bg-theme-surface text-theme-text-secondary border-theme-surface-border rounded-full border px-4 py-2 backdrop-blur-xs">
              Tamper-Proof Audit Logs
            </span>
          </div>

          {/* Call to action */}
          <div className="mt-12">
            <button
              onClick={() => void navigate('/onboarding')}
              className="transform rounded-lg bg-linear-to-r from-red-600 to-orange-600 px-8 py-4 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:from-red-700 hover:to-orange-700 hover:shadow-xl"
            >
              Get Started
            </button>
          </div>

          {/* Footer */}
          <div className="text-theme-text-muted mt-12 text-sm">
            <p>Built with care by volunteer firefighters, for volunteer firefighters</p>
            <p className="mt-2">Open Source | MIT Licensed | Community Driven</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
