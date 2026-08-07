import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosError } from 'axios';
import {
  reportError,
  reportApiError,
  resetErrorReportingState,
  setupGlobalErrorHandlers,
  flushQueuedReports,
  pendingReportCount,
  scrubSensitive,
} from './errorReporting';

// The transport posts with a bare fetch (not the shared axios client), so the
// module is isolated by stubbing fetch itself.
const mockFetch = vi.fn();

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

function ok() {
  return Promise.resolve({ ok: true, status: 200 } as Response);
}

function serverError() {
  return Promise.resolve({ ok: false, status: 500 } as Response);
}

/** Body of the nth fetch call, parsed. */
function sentBody(callIndex = 0): Record<string, unknown> {
  const init = mockFetch.mock.calls[callIndex]?.[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function sentBodies(): Array<Record<string, unknown>> {
  return mockFetch.mock.calls.map(
    (call) => JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>,
  );
}

/** Let the queue drain: delivery is async even when fetch resolves instantly. */
async function settle(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetErrorReportingState();
  mockFetch.mockImplementation(ok);
  vi.stubGlobal('fetch', mockFetch);
  localStorage.setItem('has_session', '1');
});

afterEach(() => {
  localStorage.removeItem('has_session');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('reportError', () => {
  it('posts the error to the monitoring endpoint', async () => {
    reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' });
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe('/api/v1/errors/log');
    expect(sentBody()).toMatchObject({
      error_type: 'NETWORK_ERROR',
      error_message: 'offline',
      user_message:
        'Unable to connect to the server. Please check your internet connection.',
    });
  });

  it('fills troubleshooting steps from the catalog so admins see the same guidance', async () => {
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    await settle();

    expect((sentBody()['troubleshooting_steps'] as string[]).length).toBeGreaterThan(0);
  });

  it('tags the report as frontend and records the page', async () => {
    reportError({ errorType: 'UNCAUGHT_EXCEPTION', errorMessage: 'boom' });
    await settle();

    expect(sentBody()['context']).toMatchObject({
      source: 'frontend',
      page: window.location.pathname,
    });
  });

  it('sends credentials and the CSRF token', async () => {
    document.cookie = 'csrf_token=tok-123';

    reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' });
    await settle();

    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok-123');
    expect(init.credentials).toBe('include');

    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('does not throw when the post fails', async () => {
    mockFetch.mockRejectedValue(new Error('endpoint down'));

    expect(() =>
      reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' }),
    ).not.toThrow();
    await settle();
  });
});

describe('scrubbing', () => {
  it.each([
    ['Failed to email chief@fallschurchfire.org', '[email]'],
    ['Member phone 703-555-0198 is invalid', '[phone]'],
    ['SSN 123-45-6789 rejected', '[ssn]'],
    ['Authorization: Bearer abc.def-ghi_jkl', 'Bearer [redacted]'],
    ['token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '[jwt]'],
  ])('scrubs identifiers out of %s', (input, expected) => {
    expect(scrubSensitive(input)).toContain(expected);
  });

  it('leaves ordinary diagnostic text intact', () => {
    const message = 'HTTP 500: An unexpected error occurred on /api/v1/events/42';
    expect(scrubSensitive(message)).toBe(message);
  });

  it('scrubs before the report leaves the browser', async () => {
    reportError({
      errorType: 'API_SERVER_ERROR',
      errorMessage: 'Could not notify medic@example.org',
    });
    await settle();

    expect(sentBody()['error_message']).toBe('Could not notify [email]');
  });
});

describe('throttling', () => {
  it('collapses identical errors inside the dedupe window', async () => {
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports how many times a collapsed error actually occurred', async () => {
    vi.useFakeTimers();

    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    for (let i = 0; i < 4; i += 1) {
      reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    }
    vi.advanceTimersByTime(61_000);
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    await vi.runAllTimersAsync();

    // First send has no count; the second carries the four it swallowed.
    expect(sentBody(0)['context']).not.toHaveProperty('occurrences');
    expect(sentBody(1)['context']).toMatchObject({ occurrences: 5 });
  });

  it('reports distinct errors separately', async () => {
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    reportError({ errorType: 'API_TIMEOUT', errorMessage: 'timeout of 30000ms' });
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('caps total reports per window so one broken loop cannot flood the table', async () => {
    for (let i = 0; i < 50; i += 1) {
      reportError({ errorType: 'API_SERVER_ERROR', errorMessage: `failure ${i}` });
    }
    await settle();

    const reports = sentBodies().filter(
      (b) => b['error_type'] !== 'REPORTING_THROTTLED',
    );
    expect(reports).toHaveLength(20);
    // The 30 it refused are accounted for rather than forgotten.
    expect(sentBodies().some((b) => b['error_type'] === 'REPORTING_THROTTLED')).toBe(
      true,
    );
  });

  it('reports what the rate cap discarded rather than going silently quiet', async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 30; i += 1) {
      reportError({ errorType: 'API_SERVER_ERROR', errorMessage: `failure ${i}` });
    }
    vi.advanceTimersByTime(61_000);
    reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' });
    await vi.runAllTimersAsync();

    const summary = sentBodies().find((b) => b['error_type'] === 'REPORTING_THROTTLED');
    expect(summary).toBeDefined();
    expect(summary?.['context']).toMatchObject({ dropped_by_rate_cap: 10 });
  });
});

describe('delivery', () => {
  it('retries a report the server failed to store', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce(serverError).mockImplementation(ok);

    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(pendingReportCount()).toBe(0);
  });

  it('retries a report the network never delivered', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockImplementationOnce(() => Promise.reject(new Error('offline')))
      .mockImplementation(ok);

    reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after a bounded number of attempts', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));

    reportError({ errorType: 'NETWORK_ERROR', errorMessage: 'offline' });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(pendingReportCount()).toBe(0);
  });

  it('does not retry a report the server rejected outright', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 429 } as Response),
    );

    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(pendingReportCount()).toBe(0);
  });

  it('holds a report whose session lapsed mid-flight, rather than losing it', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401 } as Response),
    );

    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    await vi.runAllTimersAsync();

    expect(pendingReportCount()).toBe(1);

    // ...and it goes out on the next login flush.
    mockFetch.mockImplementation(ok);
    flushQueuedReports();
    await vi.runAllTimersAsync();

    expect(pendingReportCount()).toBe(0);
  });

  it('holds reports raised before sign-in instead of dropping them', async () => {
    localStorage.removeItem('has_session');

    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'login failed' });
    await settle();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(pendingReportCount()).toBe(1);
  });

  it('delivers held reports once a session exists', async () => {
    localStorage.removeItem('has_session');
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'login failed' });
    await settle();

    localStorage.setItem('has_session', '1');
    flushQueuedReports();
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sentBody()['error_message']).toBe('login failed');
  });

  it('bounds the held queue so a long offline session cannot grow it forever', async () => {
    localStorage.removeItem('has_session');

    for (let i = 0; i < 80; i += 1) {
      reportError({ errorType: 'API_SERVER_ERROR', errorMessage: `failure ${i}` });
    }
    await settle();

    expect(pendingReportCount()).toBeLessThanOrEqual(50);
  });
});

describe('reportApiError', () => {
  it('reports a 500 as a server error with request context', async () => {
    reportApiError(
      axiosError({
        status: 500,
        config: { url: '/events/1', method: 'post', baseURL: '/api/v1' },
      }),
    );
    await settle();

    expect(sentBody()).toMatchObject({ error_type: 'API_SERVER_ERROR' });
    expect(sentBody()['context']).toMatchObject({
      method: 'POST',
      path: '/events/1',
      status: 500,
    });
  });

  it('distinguishes 503 as a service-unavailable error', async () => {
    reportApiError(axiosError({ status: 503 }));
    await settle();

    expect(sentBody()).toMatchObject({ error_type: 'API_SERVICE_UNAVAILABLE' });
  });

  it('reports 403 so permission misconfiguration is visible to admins', async () => {
    reportApiError(axiosError({ status: 403 }));
    await settle();

    expect(sentBody()).toMatchObject({ error_type: 'API_FORBIDDEN' });
  });

  it.each([400, 401, 404, 409, 422])(
    'does not report routine %i responses',
    async (status) => {
      reportApiError(axiosError({ status }));
      await settle();

      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it('reports a transport failure as a network error', async () => {
    reportApiError(axiosError({ message: 'Network Error', code: 'ERR_NETWORK' }));
    await settle();

    expect(sentBody()).toMatchObject({ error_type: 'NETWORK_ERROR' });
  });

  it('reports an aborted-by-timeout request as a timeout', async () => {
    reportApiError(
      axiosError({ message: 'timeout of 30000ms exceeded', code: 'ECONNABORTED' }),
    );
    await settle();

    expect(sentBody()).toMatchObject({ error_type: 'API_TIMEOUT' });
  });

  it('ignores requests the app itself cancelled', async () => {
    reportApiError(axiosError({ code: 'ERR_CANCELED', message: 'canceled' }));
    await settle();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('never reports a failure of the error-log endpoint itself', async () => {
    reportApiError(
      axiosError({
        status: 500,
        config: { url: '/errors/log', method: 'post', baseURL: '/api/v1' },
      }),
    );
    await settle();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('drops the query string, which can carry member data', async () => {
    reportApiError(
      axiosError({
        status: 500,
        config: { url: '/users?search=jane+doe', method: 'get', baseURL: '/api/v1' },
      }),
    );
    await settle();

    expect(sentBody()['context']).toMatchObject({ path: '/users' });
  });

  it('reports an error only once even if handled twice', async () => {
    const error = axiosError({ status: 500 });

    reportApiError(error);
    reportApiError(error);
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('setupGlobalErrorHandlers', () => {
  beforeEach(() => {
    setupGlobalErrorHandlers();
  });

  it('reports an uncaught exception that never reaches an ErrorBoundary', async () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'Cannot read properties of undefined',
        filename: 'app.js',
        lineno: 12,
      }),
    );
    await settle();

    expect(sentBody()).toMatchObject({
      error_type: 'UNCAUGHT_EXCEPTION',
      error_message: 'Cannot read properties of undefined',
    });
  });

  it('ignores opaque cross-origin script errors', async () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    await settle();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ignores the benign ResizeObserver loop notice', async () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'ResizeObserver loop completed with undelivered notifications.',
      }),
    );
    await settle();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports an unhandled promise rejection', async () => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = new Error('save failed');
    window.dispatchEvent(event);
    await settle();

    expect(sentBody()).toMatchObject({
      error_type: 'UNHANDLED_REJECTION',
      error_message: 'save failed',
    });
  });

  it('classifies an unhandled axios rejection as an API failure, not a generic one', async () => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    event.reason = axiosError({ status: 500 });
    window.dispatchEvent(event);
    await settle();

    expect(sentBody()).toMatchObject({ error_type: 'API_SERVER_ERROR' });
  });

  it('flushes undelivered reports with keepalive when the page goes away', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    await vi.advanceTimersByTimeAsync(0);
    mockFetch.mockClear();
    mockFetch.mockImplementation(ok);

    window.dispatchEvent(new Event('pagehide'));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).keepalive).toBe(true);
  });

  it('keeps reports it could not flush, since the page may come back', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(() => Promise.reject(new Error('offline')));
    // More than one page-hide flush can carry.
    for (let i = 0; i < 15; i += 1) {
      reportError({ errorType: 'API_SERVER_ERROR', errorMessage: `failure ${i}` });
    }
    await vi.advanceTimersByTimeAsync(0);
    mockFetch.mockImplementation(ok);

    window.dispatchEvent(new Event('pagehide'));

    // The overflow survives the app-switch instead of being discarded.
    expect(pendingReportCount()).toBeGreaterThan(0);
  });

  it('carries the count of collapsed duplicates out on page hide', async () => {
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    await settle();
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    reportError({ errorType: 'API_SERVER_ERROR', errorMessage: 'HTTP 500' });
    mockFetch.mockClear();

    window.dispatchEvent(new Event('pagehide'));

    expect(sentBody()['context']).toMatchObject({ occurrences: 3 });
  });
});
