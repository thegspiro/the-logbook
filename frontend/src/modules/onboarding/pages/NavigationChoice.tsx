import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, PanelLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { ProgressIndicator, BackButton, ResetProgressButton, AutoSaveNotification, ErrorAlert } from '../components';
import { useOnboardingStore } from '../store';
import { useApiRequest } from '../hooks';
import { apiClient } from '../services/api-client';

const NavigationChoice: React.FC = () => {
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);

  // Zustand store
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const navigationLayout = useOnboardingStore(state => state.navigationLayout);
  const setNavigationLayout = useOnboardingStore(state => state.setNavigationLayout);
  const lastSaved = useOnboardingStore(state => state.lastSaved);

  // API request hook
  const { execute, error, canRetry, clearError } = useApiRequest();

  useEffect(() => {
    // Redirect if no department name set
    if (!departmentName) {
      navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  const handleContinue = async () => {
    if (!navigationLayout) return;

    setIsSaving(true);

    // Save department info to API
    const { data } = await execute(
      async () => {
        const response = await apiClient.saveDepartmentInfo({
          name: departmentName,
          logo: logoPreview || undefined,
          navigation_layout: navigationLayout,
        });

        if (response.error) {
          throw new Error(response.error);
        }

        return response;
      },
      {
        step: 'Navigation Choice',
        action: 'Save department information',
        userContext: `Department: ${departmentName}, Layout: ${navigationLayout}`,
      }
    );

    setIsSaving(false);

    if (data) {
      // Store navigation preference (backward compatibility)
      sessionStorage.setItem('navigationLayout', navigationLayout);

      toast.success('Department information saved');
      // Navigate to email platform choice
      navigate('/onboarding/email-platform');
    } else if (error) {
      // Display the actual error message from the backend
      toast.error(error);
    }
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      {/* Header with Logo */}
      <header className="bg-theme-nav-bg backdrop-blur-sm border-b border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          {logoPreview ? (
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden mr-4">
              <img
                src={logoPreview}
                alt={`${departmentName} logo`}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center mr-4">
              <LayoutDashboard className="w-6 h-6 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-theme-text-primary text-lg font-semibold">{departmentName}</h1>
            <p className="text-theme-text-muted text-sm">Setup in Progress</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full">
          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mb-6">
            <BackButton to="/onboarding/start" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="text-center mb-8">
            <h2 className="text-4xl md:text-5xl font-bold text-theme-text-primary mb-3">
              Choose Your Navigation Style
            </h2>
            <p className="text-xl text-theme-text-secondary">
              How would you like to navigate your intranet?
            </p>
          </div>

          {/* Navigation Options */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Top Navigation Option */}
            <button
              onClick={() => setNavigationLayout('top')}
              className={`group relative bg-theme-surface backdrop-blur-sm rounded-lg border-2 transition-all duration-300 overflow-hidden ${
                navigationLayout === 'top'
                  ? 'border-red-500 shadow-lg shadow-red-500/50'
                  : 'border-theme-surface-border hover:border-red-400/50'
              }`}
              aria-pressed={navigationLayout === 'top'}
              aria-label="Top navigation layout"
            >
              <div className="p-6">
                {/* Icon */}
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors ${
                    navigationLayout === 'top'
                      ? 'bg-red-600'
                      : 'bg-theme-surface group-hover:bg-red-600/20'
                  }`}
                >
                  <LayoutDashboard
                    className={`w-8 h-8 transition-colors ${
                      navigationLayout === 'top' ? 'text-white' : 'text-theme-text-muted'
                    }`}
                  />
                </div>

                {/* Title */}
                <h3 className="text-2xl font-bold text-theme-text-primary mb-2">
                  Top Navigation
                </h3>
                <p className="text-theme-text-secondary mb-6">
                  Links displayed horizontally across the top of the page
                </p>

                {/* Preview */}
                <div className="bg-theme-surface-secondary rounded-lg p-4 border border-theme-input-border">
                  <div className="space-y-2">
                    {/* Header bar */}
                    <div className="bg-theme-surface rounded h-8 flex items-center px-2 space-x-1">
                      <div className="bg-red-500 rounded h-4 w-12"></div>
                      <div className="bg-theme-surface-border rounded h-4 w-16"></div>
                      <div className="bg-theme-surface-border rounded h-4 w-16"></div>
                      <div className="bg-theme-surface-border rounded h-4 w-16"></div>
                      <div className="bg-theme-surface-border rounded h-4 w-16"></div>
                    </div>
                    {/* Content area */}
                    <div className="bg-theme-surface rounded h-32"></div>
                  </div>
                  <p className="text-xs text-theme-text-muted mt-3 text-center">
                    Horizontal menu bar
                  </p>
                </div>

                {/* Benefits */}
                <ul className="mt-4 space-y-2 text-sm text-theme-text-secondary">
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>More horizontal screen space</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Familiar website layout</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Better for wide screens</span>
                  </li>
                </ul>
              </div>

              {/* Selected indicator */}
              {navigationLayout === 'top' && (
                <div className="absolute top-4 right-4 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              )}
            </button>

            {/* Left Sidebar Option */}
            <button
              onClick={() => setNavigationLayout('left')}
              className={`group relative bg-theme-surface backdrop-blur-sm rounded-lg border-2 transition-all duration-300 overflow-hidden ${
                navigationLayout === 'left'
                  ? 'border-red-500 shadow-lg shadow-red-500/50'
                  : 'border-theme-surface-border hover:border-red-400/50'
              }`}
              aria-pressed={navigationLayout === 'left'}
              aria-label="Left sidebar navigation layout"
            >
              <div className="p-6">
                {/* Icon */}
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-colors ${
                    navigationLayout === 'left'
                      ? 'bg-red-600'
                      : 'bg-theme-surface group-hover:bg-red-600/20'
                  }`}
                >
                  <PanelLeft
                    className={`w-8 h-8 transition-colors ${
                      navigationLayout === 'left' ? 'text-white' : 'text-theme-text-muted'
                    }`}
                  />
                </div>

                {/* Title */}
                <h3 className="text-2xl font-bold text-theme-text-primary mb-2">
                  Left Sidebar
                </h3>
                <p className="text-theme-text-secondary mb-6">
                  Links displayed vertically down the left side of the page
                </p>

                {/* Preview */}
                <div className="bg-theme-surface-secondary rounded-lg p-4 border border-theme-input-border">
                  <div className="flex space-x-2">
                    {/* Sidebar */}
                    <div className="bg-theme-surface rounded w-16 flex flex-col space-y-1 p-1">
                      <div className="bg-red-500 rounded h-4 w-full"></div>
                      <div className="bg-theme-surface-border rounded h-4 w-full"></div>
                      <div className="bg-theme-surface-border rounded h-4 w-full"></div>
                      <div className="bg-theme-surface-border rounded h-4 w-full"></div>
                      <div className="bg-theme-surface-border rounded h-4 w-full"></div>
                    </div>
                    {/* Content area */}
                    <div className="bg-theme-surface rounded flex-1 h-32"></div>
                  </div>
                  <p className="text-xs text-theme-text-muted mt-3 text-center">
                    Vertical sidebar menu
                  </p>
                </div>

                {/* Benefits */}
                <ul className="mt-4 space-y-2 text-sm text-theme-text-secondary">
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>More vertical navigation space</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>App-like experience</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-400 mr-2">✓</span>
                    <span>Better for many menu items</span>
                  </li>
                </ul>
              </div>

              {/* Selected indicator */}
              {navigationLayout === 'left' && (
                <div className="absolute top-4 right-4 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              )}
            </button>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="max-w-md mx-auto mb-6">
              <ErrorAlert
                message={error}
                canRetry={canRetry}
                onRetry={handleContinue}
                onDismiss={clearError}
              />
            </div>
          )}

          {/* Continue Button */}
          <div className="max-w-md mx-auto sticky bottom-0 md:relative bg-gradient-to-t from-theme-bg-to via-theme-bg-to to-transparent md:bg-none pb-4 md:pb-0">
            <button
              onClick={handleContinue}
              disabled={!navigationLayout || isSaving}
              className={`w-full px-8 py-4 rounded-lg font-semibold text-lg transition-all duration-300 ${
                navigationLayout && !isSaving
                  ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                  : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              {isSaving ? 'Saving...' : 'Continue'}
            </button>

            {/* Help Text */}
            <p className="text-center text-theme-text-muted text-sm mt-4">
              Don't worry, you can change this later in settings
            </p>

          {/* Progress Indicator */}
          <ProgressIndicator currentStep={2} totalSteps={10} className="pt-6 border-t border-theme-nav-border" />

          {/* Auto-save Notification */}
          <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
          </div>
        </div>
      </main>

      {/* Footer with Department Name and Copyright */}
      <footer className="bg-theme-nav-bg backdrop-blur-sm border-t border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-theme-text-secondary text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-theme-text-muted text-xs mt-1">
            Powered by The Logbook
          </p>
        </div>
      </footer>
    </div>
  );
};

export default NavigationChoice;
