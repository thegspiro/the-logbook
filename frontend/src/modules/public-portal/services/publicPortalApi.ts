/**
 * Public Portal API Service
 *
 * Client-side API for managing the public portal configuration,
 * API keys, access logs, and data whitelist.
 */

import axios, { AxiosError } from 'axios';
import { API_TIMEOUT_MS } from '../../../constants/config';
import type {
  PublicPortalConfig,
  PublicPortalAPIKey,
  PublicPortalAPIKeyCreated,
  PublicPortalAccessLog,
  PublicPortalUsageStats,
  PublicPortalDataWhitelist,
  CreateAPIKeyRequest,
  UpdateAPIKeyRequest,
  UpdateConfigRequest,
  AccessLogFilters,
} from '../types';

const API_BASE = '/api/v1/public-portal';

// Helper to read a cookie value by name
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: API_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add CSRF header
// NOTE: Auth is handled via httpOnly cookies (withCredentials: true above).
// Tokens must NEVER be stored in or read from localStorage (HIPAA compliance).
api.interceptors.request.use(
  (config) => {
    // Double-submit CSRF token for state-changing requests
    const method = (config.method || '').toUpperCase();
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

// Shared refresh promise to prevent concurrent refresh attempts
let refreshPromise: Promise<void> | null = null;

// Response interceptor to handle token expiration via httpOnly cookie refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post('/api/v1/auth/refresh', {}, { withCredentials: true })
            .then(() => {})
            .finally(() => { refreshPromise = null; });
        }
        await refreshPromise;
        return api(originalRequest);
      } catch {
        localStorage.removeItem('has_session');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
);

// ============================================================================
// Configuration API
// ============================================================================

export const getConfig = async (): Promise<PublicPortalConfig> => {
  const response = await api.get<PublicPortalConfig>('/config');
  return response.data;
};

export const createConfig = async (
  config: UpdateConfigRequest
): Promise<PublicPortalConfig> => {
  const response = await api.post<PublicPortalConfig>('/config', config);
  return response.data;
};

export const updateConfig = async (
  config: UpdateConfigRequest
): Promise<PublicPortalConfig> => {
  const response = await api.patch<PublicPortalConfig>('/config', config);
  return response.data;
};

// ============================================================================
// API Key Management
// ============================================================================

export const listAPIKeys = async (
  includeInactive = false
): Promise<PublicPortalAPIKey[]> => {
  const response = await api.get<PublicPortalAPIKey[]>('/api-keys', {
    params: { include_inactive: includeInactive },
  });
  return response.data;
};

export const createAPIKey = async (
  data: CreateAPIKeyRequest
): Promise<PublicPortalAPIKeyCreated> => {
  const response = await api.post<PublicPortalAPIKeyCreated>('/api-keys', data);
  return response.data;
};

export const updateAPIKey = async (
  keyId: string,
  data: UpdateAPIKeyRequest
): Promise<PublicPortalAPIKey> => {
  const response = await api.patch<PublicPortalAPIKey>(`/api-keys/${keyId}`, data);
  return response.data;
};

export const revokeAPIKey = async (
  keyId: string
): Promise<{ message: string; key_prefix: string }> => {
  const response = await api.delete<{ message: string; key_prefix: string }>(`/api-keys/${keyId}`);
  return response.data;
};

// ============================================================================
// Access Logs
// ============================================================================

export const getAccessLogs = async (
  filters: AccessLogFilters = {}
): Promise<PublicPortalAccessLog[]> => {
  const response = await api.get<PublicPortalAccessLog[]>('/access-logs', {
    params: filters,
  });
  return response.data;
};

export const getUsageStats = async (): Promise<PublicPortalUsageStats> => {
  const response = await api.get<PublicPortalUsageStats>('/usage-stats');
  return response.data;
};

// ============================================================================
// Data Whitelist
// ============================================================================

export const getWhitelist = async (
  category?: string
): Promise<PublicPortalDataWhitelist[]> => {
  const response = await api.get<PublicPortalDataWhitelist[]>('/whitelist', {
    params: category ? { category } : {},
  });
  return response.data;
};

export const createWhitelistEntry = async (data: {
  data_category: string;
  field_name: string;
  is_enabled: boolean;
}): Promise<PublicPortalDataWhitelist> => {
  const response = await api.post<PublicPortalDataWhitelist>('/whitelist', data);
  return response.data;
};

export const updateWhitelistEntry = async (
  entryId: string,
  isEnabled: boolean
): Promise<PublicPortalDataWhitelist> => {
  const response = await api.patch<PublicPortalDataWhitelist>(`/whitelist/${entryId}`, {
    is_enabled: isEnabled,
  });
  return response.data;
};

export const bulkUpdateWhitelist = async (
  updates: Array<{ category: string; field: string; enabled: boolean }>
): Promise<{ message: string; updated_count: number }> => {
  const response = await api.post<{ message: string; updated_count: number }>('/whitelist/bulk-update', {
    updates,
  });
  return response.data;
};
