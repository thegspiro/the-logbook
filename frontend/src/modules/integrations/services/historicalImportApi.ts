/**
 * Historical Data Import API
 *
 * `/integrations/historical-imports`: upload a previous system's export, say
 * how to read it, and send its shift and on-call rows to shift review. Every
 * route requires `integrations.historical_import`.
 *
 * Its own client from the shared factory (cookie credentials, CSRF, refresh).
 * Module clients never pass through the global response cache, so the member
 * ids and hours these responses carry are never cached.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  AdminMemberMapping,
  AdminPreview,
  AdminSettings,
  HistoricalImportDetail,
  HistoricalImportSettingsUpdate,
  HistoricalImportSummary,
  ShiftBatch,
  DrillPreview,
  StaffingFileKind,
  StaffingPreview,
  TrainingPreview,
  TrainingSettingsUpdate,
} from '../types/historicalImport';

const api = createApiClient();

const BASE = '/integrations/historical-imports';

export const historicalImportService = {
  async listImports(): Promise<HistoricalImportSummary[]> {
    const response = await api.get<{ imports: HistoricalImportSummary[] }>(BASE);
    return Array.isArray(response.data?.imports) ? response.data.imports : [];
  },

  async upload(file: File, sourceSystem: string, timezone?: string): Promise<HistoricalImportSummary> {
    const form = new FormData();
    form.append('file', file);
    form.append('source_system', sourceSystem);
    if (timezone) form.append('timezone', timezone);
    const response = await api.post<HistoricalImportSummary>(BASE, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // A whole department's history is read, scanned and stored in one request.
      timeout: 0,
    });
    return response.data;
  },

  async getImport(importId: string): Promise<HistoricalImportDetail> {
    const response = await api.get<HistoricalImportDetail>(`${BASE}/${importId}`, { timeout: 0 });
    return response.data;
  },

  async updateSettings(importId: string, payload: HistoricalImportSettingsUpdate): Promise<HistoricalImportDetail> {
    const response = await api.patch<HistoricalImportDetail>(`${BASE}/${importId}`, payload, { timeout: 0 });
    return response.data;
  },

  async createShiftBatches(importId: string): Promise<ShiftBatch[]> {
    const response = await api.post<{ batches: ShiftBatch[] }>(`${BASE}/${importId}/shift-batches`, null, {
      timeout: 0,
    });
    return Array.isArray(response.data?.batches) ? response.data.batches : [];
  },

  async discardOpenBatches(importId: string): Promise<number> {
    const response = await api.delete<{ discarded: number }>(`${BASE}/${importId}/shift-batches`);
    return response.data?.discarded ?? 0;
  },

  async downloadLog(importId: string): Promise<Blob> {
    const response = await api.get(`${BASE}/${importId}/log`, { responseType: 'blob', timeout: 0 });
    return response.data as Blob;
  },

  async getAdminPreview(importId: string): Promise<AdminPreview> {
    const response = await api.get<AdminPreview>(`${BASE}/${importId}/admin`, { timeout: 0 });
    return response.data;
  },

  async updateAdminSettings(importId: string, settings: AdminSettings): Promise<AdminPreview> {
    const response = await api.put<AdminPreview>(`${BASE}/${importId}/admin-settings`, settings, { timeout: 0 });
    return response.data;
  },

  async updateMembers(importId: string, members: Record<string, AdminMemberMapping | null>): Promise<AdminPreview> {
    const response = await api.put<AdminPreview>(`${BASE}/${importId}/members`, { members }, { timeout: 0 });
    return response.data;
  },

  async commitAdmin(importId: string): Promise<AdminPreview> {
    const response = await api.post<AdminPreview>(`${BASE}/${importId}/admin/commit`, null, { timeout: 0 });
    return response.data;
  },

  async getTrainingPreview(
    importId: string,
    params: { search?: string | undefined; offset?: number; limit?: number } = {}
  ): Promise<TrainingPreview> {
    const response = await api.get<TrainingPreview>(`${BASE}/${importId}/training`, {
      params: { search: params.search || undefined, offset: params.offset ?? 0, limit: params.limit ?? 50 },
      timeout: 0,
    });
    return response.data;
  },

  async updateTrainingSettings(importId: string, payload: TrainingSettingsUpdate): Promise<TrainingPreview> {
    const response = await api.patch<TrainingPreview>(`${BASE}/${importId}/training-settings`, payload, {
      timeout: 0,
    });
    return response.data;
  },

  async acceptSuggestedCourses(importId: string): Promise<number> {
    const response = await api.post<{ mapped: number }>(`${BASE}/${importId}/training/accept-suggestions`, null, {
      timeout: 0,
    });
    return response.data?.mapped ?? 0;
  },

  async commitTraining(importId: string): Promise<TrainingPreview> {
    const response = await api.post<TrainingPreview>(`${BASE}/${importId}/training/commit`, null, { timeout: 0 });
    return response.data;
  },

  async getDrillPreview(importId: string, params: { offset?: number; limit?: number } = {}): Promise<DrillPreview> {
    const response = await api.get<DrillPreview>(`${BASE}/${importId}/drills`, {
      params: { offset: params.offset ?? 0, limit: params.limit ?? 100 },
      timeout: 0,
    });
    return response.data;
  },

  /** Make each held drill a session linked to the chosen requirements; safe to run again. */
  async commitDrills(importId: string): Promise<DrillPreview> {
    const response = await api.post<DrillPreview>(`${BASE}/${importId}/drills/commit`, null, { timeout: 0 });
    return response.data;
  },

  async getStaffing(importId: string): Promise<StaffingPreview> {
    const response = await api.get<StaffingPreview>(`${BASE}/${importId}/staffing`, { timeout: 0 });
    return response.data;
  },

  /** Store the seats or events file, replacing one of that kind. */
  async uploadStaffingFile(importId: string, kind: StaffingFileKind, file: File): Promise<StaffingPreview> {
    const form = new FormData();
    form.append('file', file);
    const response = await api.post<StaffingPreview>(`${BASE}/${importId}/staffing/${kind}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0,
    });
    return response.data;
  },

  /** Replace the whole column mapping of one staffing file; a null header unmaps a field. */
  async updateStaffingMapping(
    importId: string,
    kind: StaffingFileKind,
    columnMapping: Record<string, string | null>
  ): Promise<StaffingPreview> {
    const response = await api.patch<StaffingPreview>(
      `${BASE}/${importId}/staffing/${kind}`,
      { column_mapping: columnMapping },
      { timeout: 0 }
    );
    return response.data;
  },

  async removeStaffingFile(importId: string, kind: StaffingFileKind): Promise<StaffingPreview> {
    const response = await api.delete<StaffingPreview>(`${BASE}/${importId}/staffing/${kind}`, { timeout: 0 });
    return response.data;
  },

  async discard(importId: string): Promise<void> {
    await api.delete(`${BASE}/${importId}`);
  },
};
