/**
 * Shift History Import API
 *
 * `/scheduling/history-import`: upload a spreadsheet of past shifts as a
 * draft, review how it was read and grouped, settle what the import could not
 * decide, and commit it. Every route requires `scheduling.manage`.
 *
 * Its own client from the shared factory (cookie credentials, CSRF, refresh),
 * like `shiftSettingsApi`. Responses carry member names and emails; module
 * clients never pass through the global response cache, and `/scheduling/` is
 * in `UNCACHEABLE_PREFIXES` regardless.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  HistoryImportDetail,
  HistoryImportMappingsUpdate,
  HistoryImportRowUpdate,
  HistoryImportSettingsUpdate,
  HistoryImportSummary,
} from '../types/historyImport';

const api = createApiClient();

const BASE = '/scheduling/history-import';

export const historyImportService = {
  async listImports(): Promise<HistoryImportSummary[]> {
    const response = await api.get<{ imports: HistoryImportSummary[] }>(BASE);
    return Array.isArray(response.data?.imports) ? response.data.imports : [];
  },

  async upload(file: File, timezone?: string): Promise<HistoryImportSummary> {
    const form = new FormData();
    form.append('file', file);
    if (timezone) form.append('timezone', timezone);
    const response = await api.post<HistoryImportSummary>(BASE, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // A 10,000-row file is read, scanned and stored in one request.
      timeout: 0,
    });
    return response.data;
  },

  async downloadTemplate(): Promise<Blob> {
    const response = await api.get(`${BASE}/template`, { responseType: 'blob' });
    return response.data as Blob;
  },

  async getImport(importId: string): Promise<HistoryImportDetail> {
    const response = await api.get<HistoryImportDetail>(`${BASE}/${importId}`, { timeout: 0 });
    return response.data;
  },

  async updateSettings(importId: string, payload: HistoryImportSettingsUpdate): Promise<HistoryImportDetail> {
    const response = await api.patch<HistoryImportDetail>(`${BASE}/${importId}`, payload, { timeout: 0 });
    return response.data;
  },

  async updateRow(importId: string, rowId: string, payload: HistoryImportRowUpdate): Promise<HistoryImportDetail> {
    const response = await api.patch<HistoryImportDetail>(`${BASE}/${importId}/rows/${rowId}`, payload, {
      timeout: 0,
    });
    return response.data;
  },

  async updateMappings(importId: string, payload: HistoryImportMappingsUpdate): Promise<HistoryImportDetail> {
    const response = await api.put<HistoryImportDetail>(`${BASE}/${importId}/mappings`, payload, { timeout: 0 });
    return response.data;
  },

  async commit(importId: string): Promise<HistoryImportSummary> {
    const response = await api.post<HistoryImportSummary>(`${BASE}/${importId}/commit`, null, { timeout: 0 });
    return response.data;
  },

  async discard(importId: string): Promise<void> {
    await api.delete(`${BASE}/${importId}`);
  },
};
