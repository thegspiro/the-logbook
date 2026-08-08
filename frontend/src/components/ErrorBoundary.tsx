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
  isChunkError: boolean;
  copied: boolean;
}

function isChunkLoadError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('importing a module script failed')
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isChunkError: false,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error to console (or send to error tracking service)
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // A chunk-load failure is reported under its own type: it means members
    // are running a build whose assets no longer exist (a deployment landed
    // mid-session), which an administrator resolves very differently from an
    // ordinary render crash.
    errorTracker.logError(error, {
      errorType: isChunkLoadError(error) ? 'CHUNK_LOAD_ERROR' : 'REACT_ERROR_BOUNDARY',
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
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      isChunkError: false,
    });
  };

  handleCopyError = async (): Promise<void> => {
    const errorText = [
      `Error: ${this.state.error?.toString()}`,
      `\nComponent Stack: ${this.state.errorInfo?.componentStack}`,
      `\nURL: ${window.location.href}`,
      `\nTime: ${new Date().toISOString()}`,
    ].join('');

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(errorText);
      } else {
        // Fallback for non-HTTPS contexts
        const textarea = document.createElement('textarea');
        textarea.value = errorText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // clipboard not available
    }
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4">
          <div className="card w-full max-w-2xl p-8">
            <div className="text-center">
              {/* Error Icon */}
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/20">
                <svg
                  className="h-8 w-8 text-red-600 dark:text-red-400"
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
              <h1 className="text-theme-text-primary mb-2 text-2xl font-bold">
                {this.state.isChunkError ? 'New Version Available' : 'Oops! Something went wrong'}
              </h1>
              <p className="text-theme-text-secondary mb-6">
                {this.state.isChunkError
                  ? 'The application has been updated. Please reload the page to get the latest version.'
                  : "We're sorry, but something unexpected happened. Please try reloading the page or return to the dashboard."}
              </p>

              {/* Error Details (Development Only) */}
              {import.meta.env.DEV && this.state.error && (
                <details className="mb-6 text-left">
                  <summary className="mb-2 cursor-pointer text-sm text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
                    Show error details (Development)
                  </summary>
                  <div className="bg-theme-input-bg max-h-64 overflow-auto rounded-lg p-4">
                    <pre className="text-xs whitespace-pre-wrap text-red-700 dark:text-red-300">
                      <strong>Error:</strong> {this.state.error.toString()}
                      {'\n\n'}
                      <strong>Component Stack:</strong>
                      {this.state.errorInfo?.componentStack}
                    </pre>
                  </div>
                </details>
              )}

              {/* Action Buttons (#65 — improved recovery) */}
              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <button
                  onClick={this.handleRetry}
                  className="btn-primary inline-flex items-center justify-center rounded-md px-6 py-3 text-base font-medium"
                >
                  <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Try Again
                </button>
                <button
                  onClick={this.handleReload}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex items-center justify-center rounded-md border px-6 py-3 text-base font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) focus:outline-hidden"
                >
                  Reload Page
                </button>
                <button
                  onClick={this.handleGoHome}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex items-center justify-center rounded-md border px-6 py-3 text-base font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) focus:outline-hidden"
                >
                  Go to Dashboard
                </button>
              </div>

              {/* Copy error & report (#65) */}
              <div className="mt-4 flex flex-col items-center gap-2">
                <button
                  onClick={() => void this.handleCopyError()}
                  className="text-theme-text-muted hover:text-theme-text-primary text-sm transition-colors"
                >
                  {this.state.copied ? 'Copied to clipboard!' : 'Copy error details to clipboard'}
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
