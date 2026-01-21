import React from 'react';
import { getEnhancedError, type EnhancedErrorProps } from '../services/errorTracking';

/**
 * Enhanced Error Display Component
 *
 * Shows user-friendly error messages with troubleshooting steps and retry options.
 */
const EnhancedError: React.FC<EnhancedErrorProps> = ({ error, eventId, userId, onRetry }) => {
  const errorLog = getEnhancedError(error, { eventId, userId });

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6">
      {/* Error Icon and Title */}
      <div className="flex items-start mb-4">
        <div className="flex-shrink-0">
          <svg
            className="h-6 w-6 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-lg font-medium text-red-900">
            {errorLog.errorType === 'UNKNOWN_ERROR' ? 'An Error Occurred' : 'Unable to Complete Action'}
          </h3>
        </div>
      </div>

      {/* User-Friendly Message */}
      <div className="ml-9">
        <p className="text-red-800 mb-4">{errorLog.userMessage}</p>

        {/* Troubleshooting Steps */}
        {errorLog.troubleshootingSteps.length > 0 && (
          <div className="bg-white border border-red-200 rounded-md p-4 mb-4">
            <h4 className="text-sm font-semibold text-red-900 mb-2">What you can try:</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-red-800">
              {errorLog.troubleshootingSteps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Retry Button */}
        {onRetry && (
          <div className="flex items-center gap-3">
            <button
              onClick={onRetry}
              className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <svg
                className="mr-2 h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Try Again
            </button>

            {/* Error ID for support */}
            <span className="text-xs text-red-600">
              Error ID: {errorLog.id.split('-')[0]}
            </span>
          </div>
        )}

        {/* Technical Details (collapsible, for debugging) */}
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-4">
            <summary className="text-xs text-red-700 cursor-pointer hover:text-red-900">
              Technical Details (Development Only)
            </summary>
            <pre className="mt-2 text-xs text-red-700 bg-red-100 p-2 rounded overflow-x-auto">
              {JSON.stringify(
                {
                  errorType: errorLog.errorType,
                  errorMessage: errorLog.errorMessage,
                  timestamp: errorLog.timestamp,
                  context: errorLog.context,
                },
                null,
                2
              )}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
};

export default EnhancedError;
