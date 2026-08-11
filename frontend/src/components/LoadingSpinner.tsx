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

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', message, fullScreen = false }) => {
  const sizeClasses = {
    sm: 'h-6 w-6 border-2',
    md: 'h-12 w-12 border-b-2',
    lg: 'h-16 w-16 border-b-4',
  };

  const spinner = (
    <div className="text-center" role="status" aria-live="polite" aria-atomic="true">
      <div
        className={`inline-block animate-spin rounded-full ${sizeClasses[size]} border-red-600`}
        aria-hidden="true"
      />
      {message ? (
        <p className="text-theme-text-secondary mt-4 text-lg">{message}</p>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br">
        {spinner}
      </div>
    );
  }

  return <div className="flex items-center justify-center py-8">{spinner}</div>;
};
