import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { LayoutDashboard, PanelLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  ResetProgressButton,
  AutoSaveNotification,
  ErrorAlert,
} from '../components';
import { useOnboardingStore } from '../store';
import { useApiRequest } from '../hooks';
import { apiClient } from '../services/api-client';

const NavigationChoice: React.FC = () => {
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);

  // Zustand store
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const navigationLayout = useOnboardingStore((state) => state.navigationLayout);
  const setNavigationLayout = useOnboardingStore((state) => state.setNavigationLayout);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);

  // API request hook
  const { execute, error, canRetry, clearError } = useApiRequest();

  useEffect(() => {
    // Redirect if no department name set
    if (!departmentName) {
      void navigate('/onboarding/start');
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
      void navigate('/onboarding/email-platform');
    } else if (error) {
      // Display the actual error message from the backend
      toast.error(error);
    }
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader
        departmentName={departmentName}
        logoPreview={logoPreview}
        icon={<LayoutDashboard aria-hidden="true" className="h-6 w-6 text-white" />}
      />

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-4xl">
          {/* Navigation Buttons */}
          <div className="mb-6 flex items-center justify-between">
            <BackButton to="/onboarding/apparatus" />
            <ResetProgressButton />
          </div>

          {/* Page Header */}
          <div className="mb-8 text-center">
            <h2 className="text-theme-text-primary mb-3 text-4xl font-bold md:text-5xl">
              Choose Your Navigation Style
            </h2>
            <p className="text-theme-text-secondary text-xl">How would you like to navigate your intranet?</p>
          </div>

          {/* Navigation Options */}
          <div className="mb-8 grid gap-6 md:grid-cols-2">
            {/* Top Navigation Option */}
            <button
              onClick={() => setNavigationLayout('top')}
              className={`group bg-theme-surface relative overflow-hidden rounded-lg border-2 backdrop-blur-xs transition-all duration-300 ${
                navigationLayout === 'top'
                  ? 'border-theme-accent-red shadow-lg'
                  : 'border-theme-surface-border hover:border-theme-accent-red'
              }`}
              aria-pressed={navigationLayout === 'top'}
              aria-label="Top navigation layout"
            >
              <div className="p-6">
                {/* Icon */}
                <div
                  className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
                    navigationLayout === 'top' ? 'bg-red-600' : 'bg-theme-surface group-hover:bg-red-600/20'
                  }`}
                >
                  <LayoutDashboard
                    className={`h-8 w-8 transition-colors ${
                      navigationLayout === 'top' ? 'text-white' : 'text-theme-text-muted'
                    }`}
                  />
                </div>

                {/* Title */}
                <h3 className="text-theme-text-primary mb-2 text-2xl font-bold">Top Navigation</h3>
                <p className="text-theme-text-secondary mb-6">
                  Links displayed horizontally across the top of the page
                </p>

                {/* Preview */}
                <div className="bg-theme-surface-secondary border-theme-input-border rounded-lg border p-4">
                  <div className="space-y-2">
                    {/* Header bar */}
                    <div className="bg-theme-surface flex h-8 items-center space-x-1 rounded-sm px-2">
                      <div className="h-4 w-12 rounded-sm bg-red-500"></div>
                      <div className="bg-theme-surface-border h-4 w-16 rounded-sm"></div>
                      <div className="bg-theme-surface-border h-4 w-16 rounded-sm"></div>
                      <div className="bg-theme-surface-border h-4 w-16 rounded-sm"></div>
                      <div className="bg-theme-surface-border h-4 w-16 rounded-sm"></div>
                    </div>
                    {/* Content area */}
                    <div className="bg-theme-surface h-32 rounded-sm"></div>
                  </div>
                  <p className="text-theme-text-muted mt-3 text-center text-xs">Horizontal menu bar</p>
                </div>

                {/* Benefits */}
                <ul className="text-theme-text-secondary mt-4 space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="text-theme-accent-green mr-2">✓</span>
                    <span>More horizontal screen space</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-theme-accent-green mr-2">✓</span>
                    <span>Familiar website layout</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-theme-accent-green mr-2">✓</span>
                    <span>Better for wide screens</span>
                  </li>
                </ul>
              </div>

              {/* Selected indicator */}
              {navigationLayout === 'top' && (
                <div className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-red-600">
                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>

            {/* Left Sidebar Option */}
            <button
              onClick={() => setNavigationLayout('left')}
              className={`group bg-theme-surface relative overflow-hidden rounded-lg border-2 backdrop-blur-xs transition-all duration-300 ${
                navigationLayout === 'left'
                  ? 'border-theme-accent-red shadow-lg'
                  : 'border-theme-surface-border hover:border-theme-accent-red'
              }`}
              aria-pressed={navigationLayout === 'left'}
              aria-label="Left sidebar navigation layout"
            >
              <div className="p-6">
                {/* Icon */}
                <div
                  className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
                    navigationLayout === 'left' ? 'bg-red-600' : 'bg-theme-surface group-hover:bg-red-600/20'
                  }`}
                >
                  <PanelLeft
                    className={`h-8 w-8 transition-colors ${
                      navigationLayout === 'left' ? 'text-white' : 'text-theme-text-muted'
                    }`}
                  />
                </div>

                {/* Title */}
                <h3 className="text-theme-text-primary mb-2 text-2xl font-bold">Left Sidebar</h3>
                <p className="text-theme-text-secondary mb-6">
                  Links displayed vertically down the left side of the page
                </p>

                {/* Preview */}
                <div className="bg-theme-surface-secondary border-theme-input-border rounded-lg border p-4">
                  <div className="flex space-x-2">
                    {/* Sidebar */}
                    <div className="bg-theme-surface flex w-16 flex-col space-y-1 rounded-sm p-1">
                      <div className="h-4 w-full rounded-sm bg-red-500"></div>
                      <div className="bg-theme-surface-border h-4 w-full rounded-sm"></div>
                      <div className="bg-theme-surface-border h-4 w-full rounded-sm"></div>
                      <div className="bg-theme-surface-border h-4 w-full rounded-sm"></div>
                      <div className="bg-theme-surface-border h-4 w-full rounded-sm"></div>
                    </div>
                    {/* Content area */}
                    <div className="bg-theme-surface h-32 flex-1 rounded-sm"></div>
                  </div>
                  <p className="text-theme-text-muted mt-3 text-center text-xs">Vertical sidebar menu</p>
                </div>

                {/* Benefits */}
                <ul className="text-theme-text-secondary mt-4 space-y-2 text-sm">
                  <li className="flex items-start">
                    <span className="text-theme-accent-green mr-2">✓</span>
                    <span>More vertical navigation space</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-theme-accent-green mr-2">✓</span>
                    <span>App-like experience</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-theme-accent-green mr-2">✓</span>
                    <span>Better for many menu items</span>
                  </li>
                </ul>
              </div>

              {/* Selected indicator */}
              {navigationLayout === 'left' && (
                <div className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-red-600">
                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mx-auto mb-6 max-w-md">
              <ErrorAlert message={error} canRetry={canRetry} onRetry={handleContinue} onDismiss={clearError} />
            </div>
          )}

          {/* Continue Button */}
          <div className="from-theme-bg-to via-theme-bg-to sticky bottom-0 mx-auto max-w-md bg-linear-to-t to-transparent pb-[calc(1rem+env(safe-area-inset-bottom))] md:relative md:bg-none md:pb-0">
            <button
              onClick={() => {
                void handleContinue();
              }}
              disabled={!navigationLayout || isSaving}
              className={`w-full rounded-lg px-8 py-4 text-lg font-semibold transition-all duration-300 ${
                navigationLayout && !isSaving
                  ? 'transform bg-linear-to-r from-red-600 to-orange-600 text-white shadow-lg hover:scale-105 hover:from-red-700 hover:to-orange-700 hover:shadow-xl'
                  : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
              }`}
              aria-label="Continue to next step"
            >
              {isSaving ? 'Saving...' : 'Continue'}
            </button>

            {/* Help Text */}
            <p className="text-theme-text-muted mt-4 text-center text-sm">
              Don't worry, you can change this later in settings
            </p>
          </div>

          {/* Progress Indicator */}
          <ProgressIndicator step="navigation" className="border-theme-nav-border mt-6 border-t pt-6" />

          {/* Auto-save Notification */}
          <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
        </div>
      </main>

      {/* Footer with Department Name and Copyright */}
      <footer className="bg-theme-nav-bg border-theme-nav-border border-t px-6 py-4 backdrop-blur-xs">
        <div className="mx-auto max-w-7xl text-center">
          <p className="text-theme-text-secondary text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

export default NavigationChoice;
