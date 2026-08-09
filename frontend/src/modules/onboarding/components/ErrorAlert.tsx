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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onRetry?: (...args: any[]) => void | Promise<void>;

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
  // Don't render an empty error alert
  if (!message?.trim()) {
    return null;
  }

  return (
    <div
      className={`rounded-lg border border-red-500/50 bg-red-500/10 p-4 ${className}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        {/* Error Icon */}
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <h4 className="mb-1 font-semibold text-red-700 dark:text-red-300">Error</h4>
          <p className="text-sm text-red-700 dark:text-red-200">{message}</p>

          {/* Actions */}
          {(canRetry || onDismiss) && (
            <div className="mt-3 flex items-center gap-2">
              {canRetry && onRetry && (
                <button
                  onClick={() => {
                    void onRetry?.();
                  }}
                  className="inline-flex items-center rounded-sm bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                  aria-label="Retry action"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Retry
                </button>
              )}

              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:text-red-800 dark:text-red-300 dark:hover:text-red-100"
                  aria-label="Dismiss error"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}

          {canRetry && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300/70">
              You can edit the form and retry, or go back to the previous step.
            </p>
          )}
        </div>

        {/* Dismiss X */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-red-700 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            aria-label="Close error message"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};
