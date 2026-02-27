import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '../store';

/**
 * File Storage Config Placeholder Component
 * Skips detailed configuration for now - can be configured later in settings
 */
export const FileStorageConfigPlaceholder: React.FC = () => {
  const navigate = useNavigate();
  const storedPlatform = useOnboardingStore(state => state.fileStoragePlatform);
  const platform = storedPlatform || 'local';

  // Auto-redirect after a brief moment to show the user what happened
  React.useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/onboarding/authentication');
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-theme-surface backdrop-blur-sm rounded-lg p-8 text-center border border-theme-surface-border">
        <div className="text-green-400 text-5xl mb-4">{'\u2713'}</div>
        <h2 className="text-3xl font-bold text-theme-text-primary mb-4">
          File Storage Selected
        </h2>
        <p className="text-theme-text-secondary mb-2">
          You selected: <span className="text-theme-text-primary font-semibold capitalize">{platform.replace('_', ' ')}</span>
        </p>
        <p className="text-theme-text-muted text-sm mb-6">
          {'Detailed configuration can be done later in Settings \u2192 File Storage.'}
        </p>
        <div className="flex items-center justify-center gap-2 text-theme-text-muted">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></span>
          <span>Continuing to authentication...</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Security Check Placeholder Component
 * This route is not part of the main onboarding flow - redirects to modules
 */
export const SecurityCheckPlaceholder: React.FC = () => {
  const navigate = useNavigate();

  // Auto-redirect to modules page since this isn't in the main flow
  React.useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/onboarding/modules');
    }, 1500);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-theme-surface backdrop-blur-sm rounded-lg p-8 text-center border border-theme-surface-border">
        <div className="text-blue-400 text-5xl mb-4">{'\uD83D\uDD12'}</div>
        <h2 className="text-3xl font-bold text-theme-text-primary mb-4">
          Security Configuration
        </h2>
        <p className="text-theme-text-secondary mb-6">
          {'Security settings will be configured automatically based on your authentication choice. You can customize security options later in Settings \u2192 Security.'}
        </p>
        <div className="flex items-center justify-center gap-2 text-theme-text-muted">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></span>
          <span>Redirecting to module selection...</span>
        </div>
      </div>
    </div>
  );
};
