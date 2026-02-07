/**
 * ResetProgressButton Component
 *
 * Button to reset onboarding progress with confirmation modal.
 * Clears all database records and local storage, then redirects to start.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, AlertTriangle, X } from 'lucide-react';
import { apiClient } from '../services/api-client';
import { useOnboardingStore } from '../store';

interface ResetProgressButtonProps {
  /**
   * Optional className for custom styling
   */
  className?: string;
}

export const ResetProgressButton: React.FC<ResetProgressButtonProps> = ({
  className = ''
}) => {
  const navigate = useNavigate();
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

      // Clear all onboarding-related localStorage items comprehensively
      // This ensures any keys we may have missed or added later are cleared
      const localStorageKeysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('onboarding') || key === 'csrf_token' || key === 'auth_token')) {
          localStorageKeysToRemove.push(key);
        }
      }
      localStorageKeysToRemove.forEach(key => localStorage.removeItem(key));

      // Clear all session storage
      sessionStorage.clear();

      // Clear API client session
      apiClient.clearSession();

      // Close modal and redirect to start
      setShowModal(false);
      navigate('/onboarding/start');

      // Force page reload to ensure clean state
      window.location.reload();
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
        className={`inline-flex items-center px-4 py-2 text-red-400 hover:text-red-300 bg-transparent border border-red-600/50 hover:border-red-500 rounded-lg font-medium transition-all duration-300 ${className}`}
        aria-label="Reset onboarding progress"
      >
        <RotateCcw className="w-4 h-4 mr-2" />
        Reset Progress
      </button>

      {/* Confirmation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !isResetting && setShowModal(false)}
          />

          {/* Modal Content */}
          <div className="relative bg-slate-800 border border-red-500/50 rounded-xl shadow-2xl max-w-md w-full p-6">
            {/* Close Button */}
            {!isResetting && (
              <button
                onClick={() => setShowModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            {/* Warning Icon */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
            </div>

            {/* Title */}
            <h3 className="text-xl font-bold text-white text-center mb-2">
              Reset Onboarding Progress?
            </h3>

            {/* Warning Message */}
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
              <p className="text-red-200 text-sm text-center">
                <strong className="text-red-400">Warning:</strong> This action will:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-red-200">
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
              <p className="mt-3 text-red-300 text-sm text-center font-semibold">
                This action cannot be undone.
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 mb-4">
                <p className="text-red-200 text-sm text-center">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex space-x-3">
              <button
                onClick={() => setShowModal(false)}
                disabled={isResetting}
                className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={isResetting}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isResetting ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
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
