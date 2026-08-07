import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosError } from 'axios';

// The transport posts with a bare axios call (not the shared client), so the
// module under test is isolated by mocking axios itself.
const mockPost = vi.fn();
vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  },
}));

// Import AFTER mocks
import {
  reportError,
  reportApiError,
  resetErrorReportingState,
  setupGlobalErrorHandlers,
} from './errorReporting';

/** Minimal axios-error shape; only the fields the classifier reads. */
function axiosError(overrides: Partial<AxiosError> & { status?: number }): AxiosError {
  const { status, ...rest } = overrides;
  return {
    name: 'AxiosError',
    message: 'Request failed',
    isAxiosError: true,
    config: { url: '/events', method: 'get', baseURL: '/api/v1' },
    ...(status !== undefined
      ? { response: { status, data: {}, statusText: '', headers: {}, config: {} } }
      : {}),
    ...rest,
  } as AxiosError;
}

function postedBody(callIndex = 0): Record<string, unknown> {
  return mockPost.mock.calls[callIndex]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetErrorReportingState();
  mockPost.mockResolvedValue({ data: { status: 'logged' } });
  localStorage.setItem('has_session', '1');
});

afterEach(() => {
  localStorage.removeItem('has_session');
  vi.useRealTimers();
});

describe('reportError', () => {
  it('posts the error to the monitoring endpoint', () => {
    reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' });

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0]?.[0]).toBe('/api/v1/errors/log');
    expect(postedBody()).toMatchObject({
      error_type: 'NETWORK_ERROR',
      error_message: 'offline',
      user_message:
        'Unable to connect to the server. Please check your internet connection.',
    });
  });

  it('fills troubleshooting steps from the catalog so admins see the same guidance', () => {
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });

    const steps = postedBody()['troubleshooting_steps'] as string[];
    expect(steps.length).toBeGreaterThan(0);
  });

  it('tags the report as frontend and records the page', () => {
    reportError({ errorType: 'UNCAUGHT_EXCEPTION', errorMessage: 'boom' });

    expect(postedBody()['context']).toMatchObject({
      source: 'frontend',
      page: window.location.pathname,
    });
  });

  it('does not post when there is no session (the endpoint requires auth)', () => {
    localStorage.removeItem('has_session');

    reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' });

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('attaches the CSRF token when the cookie is present', () => {
    document.cookie = 'csrf_token=tok-123';

    reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' });

    const config = mockPost.mock.calls[0]?.[2] as {
      headers: Record<string, string>;
      withCredentials: boolean;
    };
    expect(config.headers['X-CSRF-Token']).toBe('tok-123');
    expect(config.withCredentials).toBe(true);

    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('does not throw when the post fails', () => {
    mockPost.mockRejectedValue(new Error('endpoint down'));

    expect(() =>
      reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' }),
    ).not.toThrow();
  });

  it('collapses identical errors inside the dedupe window', () => {
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });

    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('reports the same error again after the dedupe window elapses', () => {
    vi.useFakeTimers();

    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    vi.advanceTimersByTime(61_000);
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });

    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('reports distinct errors separately', () => {
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    reportError({ errorType: 'API_TIMEOUT', errorMessage: 'timeout of 30000ms' });

    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('caps total reports per window so one broken loop cannot flood the table', () => {
    for (let i = 0; i < 50; i += 1) {
      reportError({ errorType: 'API_SERVER_ERROR', errorMessage: `failure ${i}` });
    }

    expect(mockPost).toHaveBeenCalledTimes(20);
  });
});

describe('reportApiError', () => {
  it('reports a 500 as a server error with request context', () => {
    reportApiError(
      axiosError({ status: 500, config: { url: '/events/1', method: 'post', baseURL: '/api/v1' } }),
    );

    expect(postedBody()).toMatchObject({ error_type: 'API_SERVER_ERROR' });
    expect(postedBody()['context']).toMatchObject({
      method: 'POST',
      path: '/events/1',
      status: 500,
    });
  });

  it('distinguishes 503 as a service-unavailable error', () => {
    reportApiError(axiosError({ status: 503 }));

    expect(postedBody()).toMatchObject({ error_type: 'API_SERVICE_UNAVAILABLE' });
  });

  it('reports 403 so permission misconfiguration is visible to admins', () => {
    reportApiError(axiosError({ status: 403 }));

    expect(postedBody()).toMatchObject({ error_type: 'API_FORBIDDEN' });
  });

  it.each([400, 401, 404, 409, 422])('does not report routine %i responses', (status) => {
    reportApiError(axiosError({ status }));

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('reports a transport failure as a network error', () => {
    reportApiError(axiosError({ message: 'Network Error', code: 'ERR_NETWORK' }));

    expect(postedBody()).toMatchObject({ error_type: 'NETWORK_ERROR' });
  });

  it('reports an aborted-by-timeout request as a timeout', () => {
    reportApiError(
      axiosError({ message: 'timeout of 30000ms exceeded', code: 'ECONNABORTED' }),
    );

    expect(postedBody()).toMatchObject({ error_type: 'API_TIMEOUT' });
  });

  it('ignores requests the app itself cancelled', () => {
    reportApiError(axiosError({ code: 'ERR_CANCELED', message: 'canceled' }));

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('never reports a failure of the error-log endpoint itself', () => {
    reportApiError(
      axiosError({ status: 500, config: { url: '/errors/log', method: 'post', baseURL: '/api/v1' } }),
    );

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('drops the query string, which can carry member data', () => {
    reportApiError(
      axiosError({
        status: 500,
        config: { url: '/users?search=jane+doe', method: 'get', baseURL: '/api/v1' },
      }),
    );

    expect(postedBody()['context']).toMatchObject({ path: '/users' });
  });

  it('reports an error only once even if handled twice', () => {
    const error = axiosError({ status: 500 });

    reportApiError(error);
    reportApiError(error);

    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe('setupGlobalErrorHandlers', () => {
  beforeEach(() => {
    setupGlobalErrorHandlers();
  });

  it('reports an uncaught exception that never reaches an ErrorBoundary', () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Cannot read properties of undefined',
        filename: 'app.js',
        lineno: 12,
      }),
    );

    expect(postedBody()).toMatchObject({
      error_type: 'UNCAUGHT_EXCEPTION',
      error_message: 'Cannot read properties of undefined',
    });
  });

  it('ignores opaque cross-origin script errors', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('ignores the benign ResizeObserver loop notice', () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'ResizeObserver loop completed with undelivered notifications.',
      }),
    );

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('reports an unhandled promise rejection', () => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = new Error('save failed');
    window.dispatchEvent(event);

    expect(postedBody()).toMatchObject({
      error_type: 'UNHANDLED_REJECTION',
      error_message: 'save failed',
    });
  });

  it('classifies an unhandled axios rejection as an API failure, not a generic one', () => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = axiosError({ status: 500 });
    window.dispatchEvent(event);

    expect(postedBody()).toMatchObject({ error_type: 'API_SERVER_ERROR' });
  });
});
