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

  async discard(importId: string): Promise<void> {
    await api.delete(`${BASE}/${importId}`);
  },
};
