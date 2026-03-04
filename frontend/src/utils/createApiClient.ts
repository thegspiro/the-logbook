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
      const method = (config.method || '').toUpperCase();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrf = getCookie('csrf_token');
        if (csrf) {
          config.headers['X-CSRF-Token'] = csrf;
        }
      }
      return config;
    },
    (error: unknown) =>
      Promise.reject(error instanceof Error ? error : new Error(String(error))),
  );

  // --- Response interceptor: auto-refresh on 401 ---
  let refreshPromise: Promise<void> | null = null;

  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config;
      if (
        error.response?.status === 401 &&
        originalRequest &&
        !originalRequest._retry
      ) {
        originalRequest._retry = true;
        try {
          if (!refreshPromise) {
            refreshPromise = axios
              .post(`${baseURL}/auth/refresh`, {}, { withCredentials: true })
              .then(() => {})
              .finally(() => {
                refreshPromise = null;
              });
          }
          await refreshPromise;
          return api(originalRequest);
        } catch {
          localStorage.removeItem('has_session');
          window.location.href = '/login';
        }
      }
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  );

  return api;
}
