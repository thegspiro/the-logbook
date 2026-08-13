import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ErrorLog } from '../services/errorTracking';

const mockGetErrors = vi.fn();
const mockGetErrorStats = vi.fn();
const mockGetErrorCodes = vi.fn();

vi.mock('../services/errorTracking', () => ({
  errorTracker: {
    getErrors: (...args: unknown[]) => mockGetErrors(...args) as unknown,
    getErrorStats: (...args: unknown[]) => mockGetErrorStats(...args) as unknown,
    exportErrors: vi.fn(),
    clearErrors: vi.fn(),
  },
}));

vi.mock('../services/api', () => ({
  errorLogsService: {
    getErrorCodes: (...args: unknown[]) => mockGetErrorCodes(...args) as unknown,
  },
}));

const mockAuthState: Record<string, unknown> = {
  checkPermission: vi.fn().mockReturnValue(true),
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
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
  mockGetErrorCodes.mockResolvedValue([]);
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
      expect(screen.getByText('The server could not complete this request.')).toBeInTheDocument();
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

  it('shows how many times a collapsed error occurred', async () => {
    mockGetErrors.mockResolvedValue([makeError({ context: { source: 'frontend', occurrences: 47 } })]);

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('×47')).toBeInTheDocument();
    });
  });

  it('does not clutter a single occurrence with a count', async () => {
    mockGetErrors.mockResolvedValue([makeError({ context: { source: 'frontend', occurrences: 1 } })]);

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('API_SERVER_ERROR')).toBeInTheDocument();
    });
    expect(screen.queryByText('×1')).not.toBeInTheDocument();
  });

  it('reports a healthy system when there are no errors', async () => {
    mockGetErrors.mockResolvedValue([]);

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('No errors found')).toBeInTheDocument();
    });
  });

  it('lists the support-code reference so IT can look up a quoted code', async () => {
    mockGetErrors.mockResolvedValue([]);
    mockGetErrorCodes.mockResolvedValue([
      {
        code: 'LB-AUTH-002',
        category: 'AUTH',
        title: 'Session expired or invalid',
        description: 'A session token was presented but could not be validated.',
        resolution: ['Have the member sign in again.'],
      },
    ]);

    renderWithRouter(<ErrorMonitoringPage />);

    expect(await screen.findByText(/Error Code Reference/)).toBeInTheDocument();
    // The code appears in the table row and in the section's explainer text.
    expect(screen.getAllByText('LB-AUTH-002').length).toBeGreaterThan(0);
    expect(screen.getByText('Session expired or invalid')).toBeInTheDocument();
    expect(screen.getByText('Have the member sign in again.')).toBeInTheDocument();
  });

  it('omits the reference section when the codes cannot be loaded', async () => {
    mockGetErrors.mockResolvedValue([]);
    mockGetErrorCodes.mockRejectedValue(new Error('offline'));

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText('No errors found')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Error Code Reference/)).not.toBeInTheDocument();
  });

  it('shows the support code an API failure carried', async () => {
    mockGetErrors.mockResolvedValue([
      makeError({
        context: { source: 'frontend', method: 'POST', path: '/events/42', status: 500, error_code: 'LB-SYS-001' },
      }),
    ]);

    renderWithRouter(<ErrorMonitoringPage />);

    await waitFor(() => {
      expect(screen.getByText(/\[LB-SYS-001\]/)).toBeInTheDocument();
    });
  });

  it('shows a retryable error instead of false healthy data when loading fails', async () => {
    mockGetErrors.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const user = userEvent.setup();

    renderWithRouter(<ErrorMonitoringPage />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockGetErrors).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No errors found')).toBeInTheDocument();
  });
});
