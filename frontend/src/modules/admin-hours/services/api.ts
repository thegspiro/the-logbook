/**
 * Admin Hours API Service
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  AdminHoursCategory,
  AdminHoursCategoryCreate,
  AdminHoursCategoryUpdate,
  AdminHoursEntry,
  AdminHoursEntryCreate,
  AdminHoursEntryEdit,
  AdminHoursClockInResponse,
  AdminHoursClockOutResponse,
  AdminHoursActiveSession,
  AdminHoursActiveSessionAdmin,
  AdminHoursSummary,
  AdminHoursQRData,
  AdminHoursPaginatedEntries,
  EventHourMapping,
  EventHourMappingCreate,
  EventHourMappingUpdate,
  AdminHoursComplianceItem,
} from '../types';

const api = createApiClient();

// =============================================================================
// Categories
// =============================================================================

export const adminHoursCategoryService = {
  async list(params?: { includeInactive?: boolean | undefined }): Promise<AdminHoursCategory[]> {
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
    status?: string | undefined;
    categoryId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    skip?: number | undefined;
    limit?: number | undefined;
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
    status?: string | undefined;
    categoryId?: string | undefined;
    userId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    skip?: number | undefined;
    limit?: number | undefined;
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

  async editEntry(entryId: string, data: AdminHoursEntryEdit): Promise<AdminHoursEntry> {
    const response = await api.patch<AdminHoursEntry>(`/admin-hours/entries/${entryId}`, data);
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
    userId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
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
    status?: string | undefined;
    categoryId?: string | undefined;
    userId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
  }): string {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.categoryId) searchParams.set('category_id', params.categoryId);
    if (params?.userId) searchParams.set('user_id', params.userId);
    if (params?.startDate) searchParams.set('start_date', params.startDate);
    if (params?.endDate) searchParams.set('end_date', params.endDate);
    const qs = searchParams.toString();
    return `/api/v1/admin-hours/entries/export${qs ? `?${qs}` : ''}`;
  },

  async closeStaleSessions(): Promise<{ closedCount: number }> {
    const response = await api.post<{ closedCount: number }>('/admin-hours/close-stale-sessions');
    return response.data;
  },

  async listActiveSessions(): Promise<AdminHoursActiveSessionAdmin[]> {
    const response = await api.get<AdminHoursActiveSessionAdmin[]>('/admin-hours/active-sessions');
    return response.data;
  },

  async forceClockOut(entryId: string): Promise<AdminHoursEntry> {
    const response = await api.post<AdminHoursEntry>(`/admin-hours/entries/${entryId}/force-clock-out`);
    return response.data;
  },
};

// =============================================================================
// Event Hour Mappings
// =============================================================================

// =============================================================================
// Admin Hours Compliance
// =============================================================================

export const adminHoursComplianceService = {
  async getUserCompliance(userId: string, year?: number): Promise<AdminHoursComplianceItem[]> {
    const response = await api.get<AdminHoursComplianceItem[]>(`/admin-hours/compliance/${userId}`, {
      params: year ? { year } : undefined,
    });
    return response.data;
  },
};

export const eventHourMappingService = {
  async list(params?: { includeInactive?: boolean | undefined }): Promise<EventHourMapping[]> {
    const response = await api.get<EventHourMapping[]>('/admin-hours/event-mappings', {
      params: { include_inactive: params?.includeInactive ?? false },
    });
    return response.data;
  },

  async create(data: EventHourMappingCreate): Promise<EventHourMapping> {
    const response = await api.post<EventHourMapping>('/admin-hours/event-mappings', data);
    return response.data;
  },

  async update(mappingId: string, data: EventHourMappingUpdate): Promise<EventHourMapping> {
    const response = await api.patch<EventHourMapping>(`/admin-hours/event-mappings/${mappingId}`, data);
    return response.data;
  },

  async delete(mappingId: string): Promise<void> {
    await api.delete(`/admin-hours/event-mappings/${mappingId}`);
  },
};

// =============================================================================
// Seed Defaults
// =============================================================================

export const adminHoursSeedService = {
  async seedDefaults(): Promise<{ categories_count: number; category_names: string[]; mappings_created: number }> {
    const response = await api.post<{ categories_count: number; category_names: string[]; mappings_created: number }>('/admin-hours/seed-defaults');
    return response.data;
  },
};
