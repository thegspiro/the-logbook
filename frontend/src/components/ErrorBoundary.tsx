/**
 * Error Boundary Component
 *
 * Catches React errors and prevents the entire app from crashing.
 * Displays a user-friendly error message with the option to reload.
 */

import { Component, ErrorInfo, ReactNode } from 'react';
import { errorTracker } from '../services/errorTracking';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error to console (or send to error tracking service)
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    errorTracker.logError(error, {
      errorType: 'REACT_ERROR_BOUNDARY',
      additionalContext: { componentStack: errorInfo.componentStack },
    });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/dashboard';
  };

  handleRetry = (): void => {
    // Try to recover by resetting the error state (#65)
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleCopyError = (): void => {
    const errorText = [
      `Error: ${this.state.error?.toString()}`,
      `\nComponent Stack: ${this.state.errorInfo?.componentStack}`,
      `\nURL: ${window.location.href}`,
      `\nTime: ${new Date().toISOString()}`,
    ].join('');
    navigator.clipboard.writeText(errorText).catch(() => { /* clipboard not available */ });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-8">
            <div className="text-center">
              {/* Error Icon */}
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
                <svg
                  className="h-8 w-8 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>

              {/* Error Message */}
              <h1 className="text-2xl font-bold text-theme-text-primary mb-2">
                Oops! Something went wrong
              </h1>
              <p className="text-theme-text-secondary mb-6">
                We're sorry, but something unexpected happened. Please try reloading the page or
                return to the dashboard.
              </p>

              {/* Error Details (Development Only) */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="mb-6 text-left">
                  <summary className="cursor-pointer text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 mb-2">
                    Show error details (Development)
                  </summary>
                  <div className="bg-theme-input-bg rounded-lg p-4 overflow-auto max-h-64">
                    <pre className="text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap">
                      <strong>Error:</strong> {this.state.error.toString()}
                      {'\n\n'}
                      <strong>Component Stack:</strong>
                      {this.state.errorInfo?.componentStack}
                    </pre>
                  </div>
                </details>
              )}

              {/* Action Buttons (#65 — improved recovery) */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={this.handleRetry}
                  className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                >
                  <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Try Again
                </button>
                <button
                  onClick={this.handleReload}
                  className="inline-flex items-center justify-center px-6 py-3 border border-theme-surface-border text-base font-medium rounded-md text-theme-text-primary bg-theme-surface hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--ring-offset-bg)] focus:ring-red-500 transition-colors"
                >
                  Reload Page
                </button>
                <button
                  onClick={this.handleGoHome}
                  className="inline-flex items-center justify-center px-6 py-3 border border-theme-surface-border text-base font-medium rounded-md text-theme-text-primary bg-theme-surface hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--ring-offset-bg)] focus:ring-red-500 transition-colors"
                >
                  Go to Dashboard
                </button>
              </div>

              {/* Copy error & report (#65) */}
              <div className="mt-4 flex flex-col items-center gap-2">
                <button
                  onClick={this.handleCopyError}
                  className="text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
                >
                  Copy error details to clipboard
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
