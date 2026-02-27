/**
 * Admin Hours API Service
 */

import axios, { AxiosError } from 'axios';
import { API_TIMEOUT_MS } from '../../../constants/config';
import type {
  AdminHoursCategory,
  AdminHoursCategoryCreate,
  AdminHoursCategoryUpdate,
  AdminHoursEntry,
  AdminHoursEntryCreate,
  AdminHoursClockInResponse,
  AdminHoursClockOutResponse,
  AdminHoursActiveSession,
  AdminHoursSummary,
  AdminHoursQRData,
} from '../types';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retry?: boolean;
  }
}

const API_BASE_URL = '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
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

let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        if (!refreshPromise) {
          refreshPromise = axios
            .post<{ access_token: string; refresh_token?: string }>(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken }, { withCredentials: true })
            .then((response) => {
              const { access_token, refresh_token: newRefreshToken } = response.data;
              localStorage.setItem('access_token', access_token);
              if (newRefreshToken) localStorage.setItem('refresh_token', newRefreshToken);
              return access_token;
            })
            .finally(() => { refreshPromise = null; });
        }
        const newAccessToken = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
);

// =============================================================================
// Categories
// =============================================================================

export const adminHoursCategoryService = {
  async list(params?: { includeInactive?: boolean }): Promise<AdminHoursCategory[]> {
    const response = await api.get<AdminHoursCategory[]>('/admin-hours/categories', {
      params: { include_inactive: params?.includeInactive ?? false },
    });
    return response.data;
  },

  async create(data: AdminHoursCategoryCreate): Promise<AdminHoursCategory> {
    const response = await api.post<AdminHoursCategory>('/admin-hours/categories', data);
    return response.data;
  },

  async update(categoryId: string, data: AdminHoursCategoryUpdate): Promise<AdminHoursCategory> {
    const response = await api.patch<AdminHoursCategory>(`/admin-hours/categories/${categoryId}`, data);
    return response.data;
  },

  async delete(categoryId: string): Promise<void> {
    await api.delete(`/admin-hours/categories/${categoryId}`);
  },

  async getQRData(categoryId: string): Promise<AdminHoursQRData> {
    const response = await api.get<AdminHoursQRData>(`/admin-hours/categories/${categoryId}/qr-data`);
    return response.data;
  },
};

// =============================================================================
// Clock In / Clock Out
// =============================================================================

export const adminHoursClockService = {
  async clockIn(categoryId: string): Promise<AdminHoursClockInResponse> {
    const response = await api.post<AdminHoursClockInResponse>(`/admin-hours/clock-in/${categoryId}`);
    return response.data;
  },

  async clockOut(entryId: string): Promise<AdminHoursClockOutResponse> {
    const response = await api.post<AdminHoursClockOutResponse>(`/admin-hours/clock-out/${entryId}`);
    return response.data;
  },

  async clockOutByCategory(categoryId: string): Promise<AdminHoursClockOutResponse> {
    const response = await api.post<AdminHoursClockOutResponse>(`/admin-hours/clock-out-by-category/${categoryId}`);
    return response.data;
  },

  async getActiveSession(): Promise<AdminHoursActiveSession | null> {
    const response = await api.get<AdminHoursActiveSession | null>('/admin-hours/active');
    return response.data;
  },
};

// =============================================================================
// Entries
// =============================================================================

export const adminHoursEntryService = {
  async createManual(data: AdminHoursEntryCreate): Promise<AdminHoursEntry> {
    const response = await api.post<AdminHoursEntry>('/admin-hours/entries', data);
    return response.data;
  },

  async listMy(params?: {
    status?: string;
    categoryId?: string;
    skip?: number;
    limit?: number;
  }): Promise<AdminHoursEntry[]> {
    const response = await api.get<AdminHoursEntry[]>('/admin-hours/entries/my', {
      params: {
        status: params?.status,
        category_id: params?.categoryId,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
      },
    });
    return response.data;
  },

  async listAll(params?: {
    status?: string;
    categoryId?: string;
    userId?: string;
    skip?: number;
    limit?: number;
  }): Promise<AdminHoursEntry[]> {
    const response = await api.get<AdminHoursEntry[]>('/admin-hours/entries', {
      params: {
        status: params?.status,
        category_id: params?.categoryId,
        user_id: params?.userId,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
      },
    });
    return response.data;
  },

  async review(entryId: string, action: 'approve' | 'reject', rejectionReason?: string): Promise<AdminHoursEntry> {
    const response = await api.post<AdminHoursEntry>(`/admin-hours/entries/${entryId}/review`, {
      action,
      rejection_reason: rejectionReason,
    });
    return response.data;
  },

  async getSummary(params?: {
    userId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<AdminHoursSummary> {
    const response = await api.get<AdminHoursSummary>('/admin-hours/summary', {
      params: {
        user_id: params?.userId,
        start_date: params?.startDate,
        end_date: params?.endDate,
      },
    });
    return response.data;
  },
};
