/**
 * LoadingOverlay Component
 *
 * Displays a loading spinner overlay
 * Used for async file operations (Option A implementation)
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingOverlayProps {
  /**
   * Loading message to display
   */
  message?: string;

  /**
   * Whether overlay is visible
   */
  isVisible: boolean;

  /**
   * Optional className
   */
  className?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  message = 'Processing...',
  isVisible,
  className = '',
}) => {
  if (!isVisible) return null;

  return (
    <div
      className={`bg-theme-input-bg absolute inset-0 z-50 flex items-center justify-center rounded-lg backdrop-blur-xs ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="text-center">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-red-700 dark:text-red-500" />
        <p className="text-theme-text-primary text-sm font-medium">{message}</p>
      </div>
    </div>
  );
};
