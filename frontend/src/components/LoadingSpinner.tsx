/**
 * Loading Spinner Component
 *
 * Reusable loading indicator with consistent styling
 */

import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  fullScreen?: boolean;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  message,
  fullScreen = false,
}) => {
  const sizeClasses = {
    sm: 'h-6 w-6 border-2',
    md: 'h-12 w-12 border-b-2',
    lg: 'h-16 w-16 border-b-4',
  };

  const spinner = (
    <div className="text-center">
      <div
        className={`inline-block animate-spin rounded-full ${sizeClasses[size]} border-red-600`}
        role="status"
        aria-label="Loading"
      />
      {message && (
        <p className={`mt-4 text-lg ${fullScreen ? 'text-theme-text-secondary' : 'text-theme-text-secondary'}`} aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center">
        {spinner}
      </div>
    );
  }

  return <div className="flex justify-center items-center py-8">{spinner}</div>;
};
