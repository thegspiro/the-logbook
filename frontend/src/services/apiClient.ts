/**
 * Shared Axios API Client
 *
 * Creates and configures the shared axios instance with:
 * - httpOnly cookie authentication (withCredentials)
 * - CSRF double-submit token on state-changing requests
 * - In-memory stale-while-revalidate GET cache (HIPAA-sensitive endpoints excluded)
 * - 401 → automatic refresh → retry (with shared promise to prevent races)
 * - 503 → exponential backoff retry
 *
 * Service files import `api` from this module to make typed API calls.
 */

import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import type { AxiosResponse } from 'axios';
import { API_TIMEOUT_MS } from '../constants/config';
import {
  getCacheKey,
  getCached,
  setCache,
  invalidateByPrefix,
  getResourcePrefix,
  isCacheable,
  isRevalidating,
  markRevalidating,
  clearRevalidating,
} from '../utils/apiCache';

export const API_BASE_URL = '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  withCredentials: true,  // Send httpOnly auth cookies with every request
  headers: {
    'Content-Type': 'application/json',
  },
});

// Helper to read a cookie value by name
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

// Request interceptor — httpOnly cookies are sent automatically via
// withCredentials. No tokens are stored in localStorage or sent via
// Authorization header; the browser handles cookie transport.
//
// GET responses are cached in-memory with stale-while-revalidate semantics
// to eliminate redundant fetches when navigating between pages.
api.interceptors.request.use(
  (config) => {
    const method = (config.method || '').toUpperCase();

    // --- GET response cache ---
    // Skip cache for requests explicitly marked (e.g. background revalidation)
    // and for endpoints carrying sensitive/PII data (HIPAA compliance).
    const skipCache = (config as unknown as Record<string, unknown>)._skipCache === true;
    if (method === 'GET' && !skipCache && config.url && isCacheable(config.url)) {
      const key = getCacheKey(config.url, config.params as Record<string, unknown> | undefined);
      const cached = getCached(key);

      if (cached) {
        // Build a synthetic response so the caller receives data immediately
        const syntheticResponse: AxiosResponse = {
          data: cached.data,
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };

        // Mark this config so the response interceptor doesn't re-cache stale data
        (config as unknown as Record<string, unknown>)._fromCache = true;

        // Return cached data via adapter override (skips network entirely)
        config.adapter = () => Promise.resolve(syntheticResponse);

        // If stale, trigger a background revalidation for the next caller
        if (!cached.fresh && !isRevalidating(key)) {
          markRevalidating(key);
          const { adapter: _adapter, ...restConfig } = config;
          const bgConfig = { ...restConfig, _skipCache: true };
          void api.request(bgConfig)
            .then((res) => setCache(key, res.data))
            .catch(() => { /* background revalidation failure is non-critical */ })
            .finally(() => clearRevalidating(key));
        }
      }
    }

    // Double-submit CSRF token for state-changing requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrf = getCookie('csrf_token');
      if (csrf) {
        config.headers['X-CSRF-Token'] = csrf;
      }
    }
    return config;
  },
  (error: unknown) => {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
);

// Shared refresh promise to prevent concurrent refresh attempts.
// With token rotation (SEC-11), each refresh invalidates the previous
// refresh token.  If multiple 401s fire at the same time and each
// independently tries to refresh, the second attempt looks like a
// replay attack and the backend revokes all sessions.  By sharing a
// single promise, only one refresh request is made and all waiting
// callers receive the same new access token.
let refreshPromise: Promise<void> | null = null;

// Response interceptor to handle caching and token expiration
api.interceptors.response.use(
  (response) => {
    const method = (response.config.method || '').toUpperCase();

    // Cache successful GET responses (skip cache hits and sensitive endpoints)
    if (method === 'GET' && response.config.url && isCacheable(response.config.url) && !(response.config as unknown as Record<string, unknown>)._fromCache) {
      const key = getCacheKey(
        response.config.url,
        response.config.params as Record<string, unknown> | undefined,
      );
      setCache(key, response.data);
    }

    // Invalidate related cache entries after mutations
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && response.config.url) {
      const prefix = getResourcePrefix(response.config.url);
      invalidateByPrefix(prefix);
    }

    return response;
  },
  async (error: AxiosError & { config: AxiosRequestConfig & { _retry?: boolean; _503retries?: number } }) => {
    const originalRequest = error.config;

    // 503 Service Unavailable — the backend is up but a dependency (MySQL)
    // is temporarily unreachable.  Retry with exponential backoff instead
    // of failing immediately, which prevents unnecessary logouts during
    // brief database restarts.
    if (error.response?.status === 503) {
      const retryCount = originalRequest._503retries ?? 0;
      const MAX_503_RETRIES = 3;

      if (retryCount < MAX_503_RETRIES) {
        originalRequest._503retries = retryCount + 1;
        const retryAfter = Number(error.response.headers?.['retry-after']) || 5;
        const delay = retryAfter * 1000 * Math.pow(1.5, retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return api(originalRequest);
      }
      // All retries exhausted — let it fall through as a normal error
    }

    // If 401 and we haven't retried yet, try to refresh via httpOnly cookie
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // If a refresh is already in flight, wait for it
        if (!refreshPromise) {
          // POST to /auth/refresh — the httpOnly refresh_token cookie
          // is sent automatically via withCredentials. The new tokens
          // are set as httpOnly cookies in the response.
          refreshPromise = axios
            .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
            .then(() => {
              // New cookies are set by the backend response
            })
            .finally(() => {
              refreshPromise = null;
            });
        }

        await refreshPromise;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed — clear session flag and redirect to login.
        // Skip the hard redirect during onboarding: the onboarding flow
        // manages its own session and auth cookies may not be fully
        // established yet. A hard redirect here would kick the user out
        // of onboarding and lose their progress.
        localStorage.removeItem('has_session');
        if (!window.location.pathname.startsWith('/onboarding')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError instanceof Error ? refreshError : new Error(String(refreshError)));
      }
    }

    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
);

export default api;
