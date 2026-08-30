import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosAdapter, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const mockPerformSharedRefresh = vi.fn();
const mockReportApiError = vi.fn();
const mockHandleExpiredSession = vi.fn();

vi.mock('../services/apiClient', () => ({
  performSharedRefresh: () => mockPerformSharedRefresh() as unknown,
  handleExpiredSession: () => mockHandleExpiredSession() as unknown,
}));
vi.mock('../services/errorReporting', () => ({
  reportApiError: (err: unknown) => mockReportApiError(err) as unknown,
}));

// Import AFTER the mocks are in place.
import { createApiClient } from './createApiClient';

/**
 * These tests drive the real interceptor chain rather than a mocked axios.
 *
 * This factory's whole job is the interceptors — CSRF, credentials, and the
 * 401 refresh-and-retry — so mocking axios would assert only that the test's
 * own mock was called. Stubbing the adapter instead leaves axios entirely
 * real: the request interceptor runs, the adapter stands in for the network,
 * and the response interceptor sees a genuine AxiosError.
 */
function withAdapter(api: AxiosInstance, adapter: AxiosAdapter): AxiosInstance {
  api.defaults.adapter = adapter;
  return api;
}

/** An adapter that resolves 200 and records the config it was handed. */
function okAdapter(seen: InternalAxiosRequestConfig[]): AxiosAdapter {
  return (config) => {
    seen.push(config);
    return Promise.resolve({
      data: { ok: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
  };
}

/** An AxiosError-shaped refresh failure, e.g. the refresh endpoint 503ing. */
function axiosLikeFailure(status: number, url: string): Error {
  return Object.assign(new Error(`refresh failed with ${status}`), {
    isAxiosError: true,
    config: { url, headers: {} },
    response: { status },
  });
}

/** An adapter that fails the first n calls with `status`, then succeeds. */
function failThenOkAdapter(status: number, failures: number, seen: InternalAxiosRequestConfig[]): AxiosAdapter {
  let calls = 0;
  return (config) => {
    seen.push(config);
    calls += 1;
    if (calls <= failures) {
      return Promise.reject(
        Object.assign(new Error(`Request failed with status code ${status}`), {
          isAxiosError: true,
          config,
          response: { status, data: {}, statusText: '', headers: {}, config },
        })
      );
    }
    return Promise.resolve({
      data: { retried: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
  };
}

describe('createApiClient', () => {
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPerformSharedRefresh.mockResolvedValue(undefined);
    mockHandleExpiredSession.mockReturnValue(undefined);
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    localStorage.clear();

    // Assigning window.location.href throws "Not implemented: navigation" in
    // jsdom, so stand in a plain object we can assert against.
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  describe('instance configuration', () => {
    it('sends cookies, without which every module request is unauthenticated', () => {
      expect(createApiClient().defaults.withCredentials).toBe(true);
    });

    it('defaults to the v1 API base and accepts an override', () => {
      expect(createApiClient().defaults.baseURL).toBe('/api/v1');
      expect(createApiClient('/api/v1/portal').defaults.baseURL).toBe('/api/v1/portal');
    });

    it('applies the shared request timeout', () => {
      expect(createApiClient().defaults.timeout).toBeGreaterThan(0);
    });

    it('sends JSON by default, which the FastAPI body parsers require', () => {
      expect(createApiClient().defaults.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('CSRF double-submit header', () => {
    it.each(['post', 'put', 'patch', 'delete'] as const)(
      'attaches X-CSRF-Token from the cookie on %s',
      async (method) => {
        document.cookie = 'csrf_token=token-abc';
        const seen: InternalAxiosRequestConfig[] = [];
        const api = withAdapter(createApiClient(), okAdapter(seen));

        await api[method]('/things');

        expect(seen).toHaveLength(1);
        expect(seen[0]?.headers['X-CSRF-Token']).toBe('token-abc');
      }
    );

    it('does not attach the header on a GET', async () => {
      document.cookie = 'csrf_token=token-abc';
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), okAdapter(seen));

      await api.get('/things');

      expect(seen[0]?.headers['X-CSRF-Token']).toBeUndefined();
    });

    it('omits the header when no csrf_token cookie is set', async () => {
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), okAdapter(seen));

      await api.post('/things', {});

      expect(seen[0]?.headers['X-CSRF-Token']).toBeUndefined();
    });

    it('URL-decodes the cookie value', async () => {
      document.cookie = `csrf_token=${encodeURIComponent('tok en/+=')}`;
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), okAdapter(seen));

      await api.post('/things', {});

      expect(seen[0]?.headers['X-CSRF-Token']).toBe('tok en/+=');
    });

    it('reads csrf_token exactly, not a token whose name merely ends in it', async () => {
      document.cookie = 'xsrf_csrf_token=wrong-cookie';
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), okAdapter(seen));

      await api.post('/things', {});

      expect(seen[0]?.headers['X-CSRF-Token']).toBeUndefined();
    });
  });

  describe('401 handling', () => {
    it('refreshes once and replays the original request', async () => {
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), failThenOkAdapter(401, 1, seen));

      const response = await api.get('/protected');

      expect(mockPerformSharedRefresh).toHaveBeenCalledTimes(1);
      expect(response.data).toEqual({ retried: true });
      expect(seen).toHaveLength(2);
      expect(seen[1]?.url).toBe('/protected');
    });

    it('gives up after one retry rather than looping on a persistent 401', async () => {
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), failThenOkAdapter(401, 99, seen));

      await expect(api.get('/protected')).rejects.toThrow();

      // One original attempt plus exactly one replay.
      expect(seen).toHaveLength(2);
      expect(mockPerformSharedRefresh).toHaveBeenCalledTimes(1);
    });

    // Teardown is delegated to handleExpiredSession(), which owns clearing the
    // session hint, purging the response cache, and the /login redirect — and
    // deliberately skips the redirect inside the onboarding flow.
    it('hands off to handleExpiredSession when the refresh fails', async () => {
      mockPerformSharedRefresh.mockRejectedValue(new Error('refresh rejected'));
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), failThenOkAdapter(401, 99, seen));

      await api.get('/protected').catch(() => undefined);

      expect(mockHandleExpiredSession).toHaveBeenCalledTimes(1);
      // The request must not be replayed when the refresh itself failed.
      expect(seen).toHaveLength(1);
    });

    // Redirecting is a side effect, not a response. If the interceptor resolved
    // here, callers would carry on against an `undefined` Axios response while
    // the browser was still navigating away.
    it('rejects the original request rather than resolving undefined', async () => {
      mockPerformSharedRefresh.mockRejectedValue(axiosLikeFailure(503, '/auth/refresh'));
      const api = withAdapter(createApiClient(), failThenOkAdapter(401, 99, []));

      await expect(api.get('/protected')).rejects.toThrow();
    });

    // The reporter filters 401s as routine session expiry, so reporting the
    // original request's 401 recorded nothing. The refresh failure is the
    // signal worth capturing — a refresh-endpoint outage, not an expired token.
    it('reports the refresh failure, not the original 401', async () => {
      const refreshFailure = axiosLikeFailure(503, '/auth/refresh');
      mockPerformSharedRefresh.mockRejectedValue(refreshFailure);
      const api = withAdapter(createApiClient(), failThenOkAdapter(401, 99, []));

      await api.get('/protected').catch(() => undefined);

      expect(mockReportApiError).toHaveBeenCalledTimes(1);
      expect(mockReportApiError).toHaveBeenCalledWith(refreshFailure);
    });

    // The report is guarded by axios.isAxiosError, so a refresh that rejects
    // with something else must not reach Error Monitoring as a malformed entry.
    it('does not report a refresh failure that is not an AxiosError', async () => {
      mockPerformSharedRefresh.mockRejectedValue(new Error('plain failure'));
      const api = withAdapter(createApiClient(), failThenOkAdapter(401, 99, []));

      await api.get('/protected').catch(() => undefined);

      expect(mockHandleExpiredSession).toHaveBeenCalledTimes(1);
      expect(mockReportApiError).not.toHaveBeenCalled();
    });

    it('does not tear the session down when the refresh succeeds', async () => {
      localStorage.setItem('has_session', 'true');
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), failThenOkAdapter(401, 1, seen));

      await api.get('/protected');

      expect(mockHandleExpiredSession).not.toHaveBeenCalled();
      expect(localStorage.getItem('has_session')).toBe('true');
    });
  });

  describe('blob error responses', () => {
    // `responseType: 'blob'` (CSV/file exports) applies to error responses
    // too — a 403/500 with a JSON body still arrives as a Blob, not parsed
    // JSON, unless the interceptor decodes it. Exercises the actual
    // request/response path (a real blob-responseType request through a
    // stub adapter) rather than asserting against the interceptor's source,
    // so it fails if the decoding regresses regardless of how the bypass
    // happens.
    function jsonBlob(body: unknown): Blob {
      return new Blob([JSON.stringify(body)], { type: 'application/json' });
    }

    function blobErrorAdapter(status: number, data: Blob): AxiosAdapter {
      return (config) =>
        Promise.reject(
          Object.assign(new Error(`Request failed with status code ${status}`), {
            isAxiosError: true,
            config,
            response: { status, data, statusText: '', headers: {}, config },
          })
        );
    }

    it('decodes a JSON error blob so the detail message and support code survive', async () => {
      const api = withAdapter(
        createApiClient(),
        blobErrorAdapter(500, jsonBlob({ detail: 'Export failed: disk quota exceeded', code: 'LB-4821' }))
      );

      await expect(api.get('/things', { responseType: 'blob' })).rejects.toMatchObject({
        response: { data: { detail: 'Export failed: disk quota exceeded', code: 'LB-4821' } },
      });

      // reportApiError's support-code extraction reads response.data.code —
      // proving the object it received is real JSON, not a Blob it happened
      // to skip over.
      expect(mockReportApiError).toHaveBeenCalledTimes(1);
      const reported = mockReportApiError.mock.calls[0]?.[0] as { response?: { data?: { code?: unknown } } };
      expect(reported.response?.data?.code).toBe('LB-4821');
    });

    it('leaves a non-JSON error blob (e.g. an HTML error page) undecoded rather than throwing', async () => {
      const htmlBlob = new Blob(['<html>502 Bad Gateway</html>'], { type: 'text/html' });
      const api = withAdapter(createApiClient(), blobErrorAdapter(502, htmlBlob));

      await expect(api.get('/things', { responseType: 'blob' })).rejects.toMatchObject({
        response: { data: htmlBlob },
      });
    });

    it('leaves a successful blob response (the normal export path) untouched', async () => {
      const csvBlob = new Blob(['a,b,c'], { type: 'text/csv' });
      const api = withAdapter(createApiClient(), () =>
        Promise.resolve({ data: csvBlob, status: 200, statusText: 'OK', headers: {}, config: {} as never })
      );

      const response = await api.get('/things', { responseType: 'blob' });

      expect(response.data).toBe(csvBlob);
    });
  });

  describe('other failures', () => {
    it.each([403, 404, 500])('does not attempt a refresh on %i', async (status) => {
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), failThenOkAdapter(status, 99, seen));

      await expect(api.get('/things')).rejects.toThrow();

      expect(mockPerformSharedRefresh).not.toHaveBeenCalled();
      expect(seen).toHaveLength(1);
    });

    // A dropped connection or a timeout produces an AxiosError with no
    // `response` at all. The status check has to tolerate that: read it
    // non-optionally and the interceptor throws a TypeError of its own,
    // replacing the real network error with a misleading one. This is the
    // everyday case for a PWA used away from signal.
    it('propagates a network error that carries no response', async () => {
      const networkError = Object.assign(new Error('Network Error'), { isAxiosError: true });
      const api = withAdapter(createApiClient(), () => Promise.reject(networkError));

      await expect(api.get('/things')).rejects.toThrow('Network Error');

      expect(mockPerformSharedRefresh).not.toHaveBeenCalled();
      expect(mockHandleExpiredSession).not.toHaveBeenCalled();
    });

    it('reports module-instance failures to the error monitor', async () => {
      const seen: InternalAxiosRequestConfig[] = [];
      const api = withAdapter(createApiClient(), failThenOkAdapter(500, 99, seen));

      await api.get('/things').catch(() => undefined);

      expect(mockReportApiError).toHaveBeenCalledTimes(1);
    });
  });
});
