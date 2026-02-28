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
  AdminHoursPaginatedEntries,
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

// Request interceptor to add CSRF header
// NOTE: Auth is handled via httpOnly cookies (withCredentials: true above).
// Tokens must NEVER be stored in or read from localStorage (HIPAA compliance).
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
  (error: unknown) => {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
);

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
            .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
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
    startDate?: string;
    endDate?: string;
    skip?: number;
    limit?: number;
  }): Promise<AdminHoursPaginatedEntries> {
    const response = await api.get<AdminHoursPaginatedEntries>('/admin-hours/entries/my', {
      params: {
        status: params?.status,
        category_id: params?.categoryId,
        start_date: params?.startDate,
        end_date: params?.endDate,
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
    startDate?: string;
    endDate?: string;
    skip?: number;
    limit?: number;
  }): Promise<AdminHoursPaginatedEntries> {
    const response = await api.get<AdminHoursPaginatedEntries>('/admin-hours/entries', {
      params: {
        status: params?.status,
        category_id: params?.categoryId,
        user_id: params?.userId,
        start_date: params?.startDate,
        end_date: params?.endDate,
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

  async bulkApprove(entryIds: string[]): Promise<{ approvedCount: number }> {
    const response = await api.post<{ approvedCount: number }>('/admin-hours/entries/bulk-approve', {
      entry_ids: entryIds,
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

  async getPendingCount(): Promise<number> {
    const response = await api.get<{ count: number }>('/admin-hours/pending-count');
    return response.data.count;
  },

  getExportUrl(params?: {
    status?: string;
    categoryId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
  }): string {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.categoryId) searchParams.set('category_id', params.categoryId);
    if (params?.userId) searchParams.set('user_id', params.userId);
    if (params?.startDate) searchParams.set('start_date', params.startDate);
    if (params?.endDate) searchParams.set('end_date', params.endDate);
    const qs = searchParams.toString();
    return `${API_BASE_URL}/admin-hours/entries/export${qs ? `?${qs}` : ''}`;
  },

  async closeStaleSessions(): Promise<{ closedCount: number }> {
    const response = await api.post<{ closedCount: number }>('/admin-hours/close-stale-sessions');
    return response.data;
  },
};
