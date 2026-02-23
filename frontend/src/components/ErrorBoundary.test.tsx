import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the error tracking service
vi.mock('../services/errorTracking', () => ({
  errorTracker: {
    logError: vi.fn(),
  },
}));

import { ErrorBoundary } from './ErrorBoundary';
import { errorTracker } from '../services/errorTracking';

const mockedLogError = vi.mocked(errorTracker.logError);

// A component that throws an error on demand
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error from child');
  }
  return <div>Child content rendered successfully</div>;
}

// A stateful wrapper that lets us toggle the throwing behavior via a ref callback
// so we can test the "Try Again" recovery path.
function TogglableThrowingChild({
  shouldThrowRef,
}: {
  shouldThrowRef: { current: boolean };
}) {
  if (shouldThrowRef.current) {
    throw new Error('Test error from child');
  }
  return <div>Child content rendered successfully</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Re-apply the mock after restoreAllMocks clears it
    mockedLogError.mockReturnValue({
      id: 'mock-id',
      timestamp: new Date(),
      errorType: 'REACT_ERROR_BOUNDARY',
      errorMessage: 'Test error from child',
      userMessage: 'Test error from child',
      troubleshootingSteps: [],
      context: {},
    });
    // Suppress console.error output from React error boundary logging
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('catches errors and displays fallback UI with "Something went wrong" message', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.queryByText('Child content rendered successfully')).not.toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it('shows "Try Again", "Reload Page", and "Go to Dashboard" buttons', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload Page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go to Dashboard/i })).toBeInTheDocument();
  });

  it('Try Again button resets error state and re-renders children', () => {
    // Use a ref so we can toggle throwing behavior after the error is caught
    const shouldThrowRef = { current: true };

    render(
      <ErrorBoundary>
        <TogglableThrowingChild shouldThrowRef={shouldThrowRef} />
      </ErrorBoundary>,
    );

    // Verify fallback UI is showing
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();

    // Stop throwing before clicking Try Again
    shouldThrowRef.current = false;

    fireEvent.click(screen.getByRole('button', { name: /Try Again/i }));

    // After reset, children should render successfully
    expect(screen.getByText('Child content rendered successfully')).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });

  it('Copy error button calls navigator.clipboard.writeText', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    const copyButton = screen.getByRole('button', { name: /Copy error details/i });
    fireEvent.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    // The copied text should contain the error message
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('Test error from child'),
    );
  });

  it('calls errorTracker.logError when error is caught', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(mockedLogError).toHaveBeenCalledTimes(1);
    expect(mockedLogError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        errorType: 'REACT_ERROR_BOUNDARY',
        additionalContext: expect.objectContaining({
          componentStack: expect.any(String),
        }),
      }),
    );
  });

  it('Reload Page button calls window.location.reload', () => {
    // Mock window.location.reload
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload: reloadMock },
    });

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Reload Page/i }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('Go to Dashboard button navigates to /dashboard', () => {
    // Set up a writable location mock
    const locationMock = { ...window.location, href: '' };
    Object.defineProperty(window, 'location', {
      writable: true,
      value: locationMock,
    });

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Go to Dashboard/i }));
    expect(locationMock.href).toBe('/dashboard');
  });
});
