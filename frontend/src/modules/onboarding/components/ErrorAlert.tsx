/**
 * ErrorAlert Component
 *
 * Displays error messages with retry functionality
 * Implements Option C: Retry button + ability to edit and resubmit
 */

import React from 'react';
import { AlertCircle, RefreshCw, X } from 'lucide-react';

interface ErrorAlertProps {
  /**
   * Error message to display
   */
  message: string;

  /**
   * Whether retry button should be shown
   */
  canRetry?: boolean;

  /**
   * Retry callback
   */
  onRetry?: () => void;

  /**
   * Dismiss callback
   */
  onDismiss?: () => void;

  /**
   * Optional className
   */
  className?: string;
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  message,
  canRetry = false,
  onRetry,
  onDismiss,
  className = '',
}) => {
  return (
    <div
      className={`bg-red-500/10 border border-red-500/50 rounded-lg p-4 ${className}`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {/* Error Icon */}
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-red-300 font-semibold mb-1">Error</h4>
          <p className="text-red-200 text-sm">{message}</p>

          {/* Actions */}
          {(canRetry || onDismiss) && (
            <div className="mt-3 flex items-center gap-2">
              {canRetry && onRetry && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors"
                  aria-label="Retry action"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Retry
                </button>
              )}

              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="inline-flex items-center px-3 py-1.5 text-red-300 hover:text-red-100 text-sm font-medium transition-colors"
                  aria-label="Dismiss error"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}

          {canRetry && (
            <p className="mt-2 text-xs text-red-300/70">
              You can edit the form and retry, or go back to the previous step.
            </p>
          )}
        </div>

        {/* Dismiss X */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-red-400 hover:text-red-300 transition-colors"
            aria-label="Close error message"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
