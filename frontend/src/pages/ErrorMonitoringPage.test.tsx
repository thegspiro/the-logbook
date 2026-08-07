import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import type { ErrorLog } from '../services/errorTracking';

const mockGetErrors = vi.fn();
const mockGetErrorStats = vi.fn();

vi.mock('../services/errorTracking', () => ({
  errorTracker: {
    getErrors: (...args: unknown[]) => mockGetErrors(...args) as unknown,
    getErrorStats: (...args: unknown[]) => mockGetErrorStats(...args) as unknown,
    exportErrors: vi.fn(),
    clearErrors: vi.fn(),
  },
}));

const mockAuthState: Record<string, unknown> = {
  checkPermission: vi.fn().mockReturnValue(true),
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState,
  ),
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Import AFTER mocks
import ErrorMonitoringPage from './ErrorMonitoringPage';

function makeError(overrides: Partial<ErrorLog> = {}): ErrorLog {
  return {
    id: 'err-1',
    timestamp: new Date('2026-08-07T12:00:00Z'),
    errorType: 'API_SERVER_ERROR',
    errorMessage: 'HTTP 500: Internal server error',
    userMessage: 'The server could not complete this request.',
    troubleshootingSteps: [],
    context: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetErrorStats.mockResolvedValue({ total: 0, byType: {}, recentErrors: [] });
});

describe('ErrorMonitoringPage', () => {
  it('shows the request that failed, so an admin can act without asking the member', async () => {
    mockGetErrors.mockResolvedValue([
      makeError({
        context: { source: 'frontend', method: 'POST', path: '/events/42', status: 500 },
      }),
    ]);

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/POST \/events\/42/)).toBeInTheDocument();
    });
    expect(screen.getByText(/→ 500/)).toBeInTheDocument();
  });

  it('shows the technical message alongside the message the member was shown', async () => {
    mockGetErrors.mockResolvedValue([makeError()]);

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(
        screen.getByText('The server could not complete this request.'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('HTTP 500: Internal server error')).toBeInTheDocument();
  });

  it('labels client-side and server-side errors distinctly', async () => {
    mockGetErrors.mockResolvedValue([
      makeError({ id: 'err-1', context: { source: 'frontend' } }),
      makeError({
        id: 'err-2',
        errorType: 'BACKEND_VALUEERROR',
        context: { source: 'backend', method: 'GET', path: '/users' },
      }),
    ]);

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('Server')).toBeInTheDocument();
    });
    expect(screen.getByText('Client')).toBeInTheDocument();
  });

  it('reports a healthy system when there are no errors', async () => {
    mockGetErrors.mockResolvedValue([]);

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('No errors found')).toBeInTheDocument();
    });
  });
});
