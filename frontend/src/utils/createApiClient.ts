/**
 * Shared Axios Client Factory
 *
 * Creates an axios instance with the standard CSRF, auth-refresh, and
 * credential handling that every module service needs.  Using this factory
 * avoids duplicating interceptor logic across module-level `services/api.ts`
 * files.
 *
 * Usage:
 *   import { createApiClient } from '@/utils/createApiClient';
 *   const api = createApiClient();                   // default baseURL '/api/v1'
 *   const api = createApiClient('/api/v1/portal');   // custom baseURL
 */

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { API_TIMEOUT_MS } from '../constants/config';
import { handleExpiredSession, performSharedRefresh } from '../services/apiClient';
import { reportApiError } from '../services/errorReporting';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

/** Read a cookie value by name (double-submit CSRF pattern). */
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Create a pre-configured axios instance with:
 *   - httpOnly cookie credentials (`withCredentials: true`)
 *   - CSRF double-submit header on state-changing methods
 *   - 401 → cookie-based refresh → retry, with shared promise to prevent races
 */
export function createApiClient(baseURL = '/api/v1'): AxiosInstance {
  const api = axios.create({
    baseURL,
    timeout: API_TIMEOUT_MS,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
  });

  // --- Request interceptor: attach CSRF token ---
  api.interceptors.request.use(
    (config) => {
      // SEC: Auth is handled exclusively via httpOnly cookies (withCredentials).
      // No Authorization header bridge — tokens are never exposed to JS.
      const method = (config.method || '').toUpperCase();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrf = getCookie('csrf_token');
        if (csrf) {
          config.headers['X-CSRF-Token'] = csrf;
        }
      }
      return config;
    },
    (error: unknown) => Promise.reject(error instanceof Error ? error : new Error(String(error)))
  );

  // --- Response interceptor: auto-refresh on 401 ---
  // Uses the globally shared refresh promise from apiClient.ts to
  // prevent concurrent refresh requests across independent axios
  // instances (which would trigger the backend's replay detection
  // and revoke all sessions).
  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      // A request made with `responseType: 'blob'` (CSV/file exports) still
      // gets `error.response.data` decoded as a Blob even when the server
      // returned a JSON error body (403/500) instead of the expected file —
      // axios applies the configured responseType to error responses too.
      // Every downstream reader (toAppError/getErrorMessage, reportApiError's
      // support-code extraction) expects parsed JSON, so an undecoded Blob
      // silently loses the backend's detail message and support code behind
      // a generic fallback. Decode it once here so every blob-response caller
      // in the app is covered, not just the one that happened to trigger this.
      if (error.response?.data instanceof Blob && error.response.data.type.includes('json')) {
        try {
          const text = await error.response.data.text();
          error.response.data = JSON.parse(text) as unknown;
        } catch {
          // Not decodable JSON (e.g. an HTML error page from a proxy) — leave
          // the Blob as is; downstream code already falls back to
          // statusText/error.message rather than throwing on it.
        }
      }

      const originalRequest = error.config;
      if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
        originalRequest._retry = true;
        try {
          await performSharedRefresh();
          return api(originalRequest);
        } catch (refreshError) {
          // Redirecting is a side effect, not a response. Reject the request as
          // well so callers cannot continue with an `undefined` Axios response
          // while the browser is navigating to the login page.
          await handleExpiredSession();
          // Report the refresh failure, not the original request's 401: the
          // reporter deliberately filters 401s as routine session expiry, so
          // reporting the original error recorded nothing. A refresh 401 is
          // still filtered (ordinary expiry), while a refresh-endpoint outage
          // (5xx / network failure) — what this report exists to capture —
          // reaches Error Monitoring.
          if (axios.isAxiosError(refreshError)) {
            reportApiError(refreshError);
          }
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }

      // Module traffic has to reach the Error Monitoring page too — a failure
      // in a module's own axios instance is no less an administrator's
      // problem than one on the global client.
      reportApiError(error);

      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  );

  return api;
}
