/**
 * ResetProgressButton Component
 *
 * Button to reset onboarding progress with confirmation modal.
 * Clears all database records and local storage, then redirects to start.
 */

import React, { useState } from 'react';
import { RotateCcw, AlertTriangle, X } from 'lucide-react';
import { apiClient } from '../services/api-client';
import { useOnboardingStore } from '../store';

interface ResetProgressButtonProps {
  /**
   * Optional className for custom styling
   */
  className?: string;
}

export const ResetProgressButton: React.FC<ResetProgressButtonProps> = ({ className = '' }) => {
  const resetOnboarding = useOnboardingStore((state) => state.resetOnboarding);
  const [showModal, setShowModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    setIsResetting(true);
    setError(null);

    try {
      // Call backend to reset database
      const response = await apiClient.resetOnboarding();

      if (response.error) {
        setError(response.error);
        setIsResetting(false);
        return;
      }

      // Clear Zustand store (which also clears localStorage via persist middleware)
      resetOnboarding();

      // Clear all onboarding-related localStorage items comprehensively.
      // This includes auth session flags set during System Owner creation
      // (step 7) and layout preferences written by the onboarding store.
      // Without clearing `has_session`, Welcome.tsx would redirect to
      // /dashboard after reset, causing auth errors because the user was
      // just deleted from the database.
      const localStorageKeysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith('onboarding') ||
            key === 'csrf_token' ||
            key === 'access_token' ||
            key === 'refresh_token' ||
            key === 'has_session' ||
            key === 'navigationLayout')
        ) {
          localStorageKeysToRemove.push(key);
        }
      }
      localStorageKeysToRemove.forEach((key) => localStorage.removeItem(key));

      // Clear all session storage
      sessionStorage.clear();

      // Clear API client session
      apiClient.clearSession();

      // Close modal and navigate with a full page load to ensure clean state.
      // Using window.location.href instead of navigate() + reload() because
      // navigate() is async and reload() would fire before it completes.
      setShowModal(false);
      window.location.href = '/onboarding/start';
    } catch (_err) {
      setError('Failed to reset onboarding. Please try again.');
      setIsResetting(false);
    }
  };

  return (
    <>
      {/* Reset Button */}
      <button
        onClick={() => setShowModal(true)}
        className={`inline-flex items-center rounded-lg border border-red-600/50 bg-transparent px-4 py-2 font-medium text-red-700 transition-all duration-300 hover:border-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 ${className}`}
        aria-label="Reset onboarding progress"
      >
        <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
        Reset Progress
      </button>

      {/* Confirmation Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-progress-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !isResetting) setShowModal(false);
          }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-xs"
            onClick={() => !isResetting && setShowModal(false)}
            aria-hidden="true"
          />

          {/* Modal Content */}
          <div className="bg-theme-surface-modal relative w-full max-w-md rounded-xl border border-red-500/50 p-6 shadow-2xl">
            {/* Close Button */}
            {!isResetting && (
              <button
                onClick={() => setShowModal(false)}
                className="text-theme-text-muted hover:text-theme-text-primary absolute top-4 right-4 transition-colors"
                aria-label="Close dialog"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            )}

            {/* Warning Icon */}
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
                <AlertTriangle className="h-8 w-8 text-red-700 dark:text-red-500" aria-hidden="true" />
              </div>
            </div>

            {/* Title */}
            <h3 id="reset-progress-title" className="text-theme-text-primary mb-2 text-center text-xl font-bold">
              Reset Onboarding Progress?
            </h3>

            {/* Warning Message */}
            <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-center text-sm text-red-700 dark:text-red-200">
                <strong className="font-semibold text-red-800 dark:text-red-400">Warning:</strong> This action will:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-red-700 dark:text-red-200">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  Delete all onboarding progress
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  Clear all database records created during setup
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  Remove any users and organizations created
                </li>
              </ul>
              <p className="mt-3 text-center text-sm font-semibold text-red-700 dark:text-red-300">
                This action cannot be undone.
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 rounded-lg border border-red-500 bg-red-500/20 p-3">
                <p className="text-center text-sm text-red-700 dark:text-red-200">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
              <button
                onClick={() => setShowModal(false)}
                disabled={isResetting}
                className="bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text-primary flex-1 rounded-lg px-4 py-3 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleReset();
                }}
                disabled={isResetting}
                className="btn-primary flex flex-1 items-center justify-center py-3 font-medium disabled:cursor-not-allowed"
              >
                {isResetting ? (
                  <>
                    <svg
                      className="text-theme-text-primary mr-2 -ml-1 h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Resetting...
                  </>
                ) : (
                  'Yes, Reset Everything'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
