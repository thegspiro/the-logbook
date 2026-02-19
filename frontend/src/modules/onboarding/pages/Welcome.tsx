import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const Welcome: React.FC = () => {
  const [showTitle, setShowTitle] = useState(false);
  const [showParagraph, setShowParagraph] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // If the user is already authenticated, go straight to the dashboard
    if (localStorage.getItem('access_token')) {
      navigate('/dashboard', { replace: true });
      return;
    }

    // Check if onboarding has already been completed by looking for an
    // existing organization.  If one exists, the user should log in
    // rather than seeing the "Get Started" onboarding splash.
    const checkOnboardingStatus = async () => {
      try {
        const response = await fetch('/api/v1/auth/branding');
        if (response.ok) {
          const data = await response.json();
          if (data.name) {
            // Organization exists → onboarding is done → go to login
            navigate('/login', { replace: true });
            return;
          }
        }
      } catch {
        // Backend not reachable yet — show the Welcome page normally
      }
      setChecking(false);
    };

    checkOnboardingStatus();
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
      <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-theme-accent-red mb-4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center p-4">
      <div className="max-w-3xl w-full text-center space-y-8">
        {/* Title */}
        <h1
          className={`text-6xl md:text-7xl font-bold text-theme-text-primary transition-all duration-1000 ${
            showTitle
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-8'
          }`}
        >
          Welcome to{' '}
          <span className="bg-gradient-to-r from-red-400 to-orange-500 bg-clip-text text-transparent">
            The Logbook
          </span>
        </h1>

        {/* Paragraph */}
        <div
          className={`transition-all duration-1000 delay-300 ${
            showParagraph
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-8'
          }`}
        >
          <p className="text-xl md:text-2xl text-theme-text-secondary leading-relaxed">
            A secure, HIPAA-compliant department intranet built by a local
            volunteer fire department and shared with the world to help other
            volunteer departments manage their operations, training, and
            community service.
          </p>

          {/* Badge indicators */}
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
            <span className="px-4 py-2 bg-theme-surface backdrop-blur-sm rounded-full text-theme-text-secondary border border-theme-surface-border">
              HIPAA Compliant
            </span>
            <span className="px-4 py-2 bg-theme-surface backdrop-blur-sm rounded-full text-theme-text-secondary border border-theme-surface-border">
              Section 508 Accessible
            </span>
            <span className="px-4 py-2 bg-theme-surface backdrop-blur-sm rounded-full text-theme-text-secondary border border-theme-surface-border">
              Zero Plain Text Passwords
            </span>
            <span className="px-4 py-2 bg-theme-surface backdrop-blur-sm rounded-full text-theme-text-secondary border border-theme-surface-border">
              Tamper-Proof Audit Logs
            </span>
          </div>

          {/* Call to action */}
          <div className="mt-12">
            <button
              onClick={() => navigate('/onboarding')}
              className="px-8 py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white text-lg font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            >
              Get Started
            </button>
          </div>

          {/* Footer */}
          <div className="mt-12 text-theme-text-muted text-sm">
            <p>
              Built with care by volunteer firefighters, for volunteer
              firefighters
            </p>
            <p className="mt-2">
              Open Source | MIT Licensed | Community Driven
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
