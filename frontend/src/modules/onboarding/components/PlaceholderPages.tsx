import React from 'react';
import { useNavigate } from 'react-router';

/**
 * Security Check Placeholder Component
 * This route is not part of the main onboarding flow - redirects to modules
 */
export const SecurityCheckPlaceholder: React.FC = () => {
  const navigate = useNavigate();

  // Auto-redirect to modules page since this isn't in the main flow
  React.useEffect(() => {
    const timer = setTimeout(() => {
      void navigate('/onboarding/modules');
    }, 1500);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4">
      <div className="card w-full max-w-2xl p-8 text-center">
        <div className="mb-4 text-5xl text-blue-700 dark:text-blue-400">{'\uD83D\uDD12'}</div>
        <h2 className="text-theme-text-primary mb-4 text-3xl font-bold">Security Configuration</h2>
        <p className="text-theme-text-secondary mb-6">
          {
            'Security settings will be configured automatically based on your authentication choice. You can customize security options later in Settings \u2192 Security.'
          }
        </p>
        <div className="text-theme-text-muted flex items-center justify-center gap-2">
          <span className="border-theme-surface-border inline-block h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></span>
          <span>Redirecting to module selection...</span>
        </div>
      </div>
    </div>
  );
};
