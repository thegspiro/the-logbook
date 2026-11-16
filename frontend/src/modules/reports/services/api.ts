/**
 * Reports API Service
 *
 * Handles all report generation, saved report management, and export.
 */

import { createApiClient } from '../../../utils/createApiClient';
import { filenameFromContentDisposition, type DownloadedFile } from '../../../utils/fileDownload';
import type {
  AvailableReportsResponse,
  ReportData,
  ReportExportFormat,
  ReportExportSource,
  ReportRequest,
  SavedReportConfig,
  SavedReportCreate,
  SavedReportUpdate,
} from '../types';
import { asArray } from '../../../utils/asArray';

const api = createApiClient();

// ============================================================================
// Report Generation
// ============================================================================

export const reportsApiService = {
  async getAvailableReports(): Promise<AvailableReportsResponse> {
    const response = await api.get<AvailableReportsResponse>('/reports/available');
    return response.data;
  },

  async generateReport(request: ReportRequest): Promise<ReportData> {
    const response = await api.post<ReportData>('/reports/generate', request);
    return response.data;
  },

  /**
   * Download a report as a PDF or CSV the server builds and audits, named as
   * the server names it (the report's title and the department's date).
   */
  async exportReport(
    source: ReportExportSource,
    format: ReportExportFormat,
    fallbackName: string
  ): Promise<DownloadedFile> {
    const response = await api.post<Blob>('/reports/export', { ...source, format }, { responseType: 'blob' });
    const header: unknown = response.headers['content-disposition'];
    return {
      blob: response.data,
      filename: filenameFromContentDisposition(typeof header === 'string' ? header : undefined) ?? fallbackName,
    };
  },
};

// ============================================================================
// Saved / Scheduled Reports
// ============================================================================

export const savedReportsService = {
  async list(): Promise<SavedReportConfig[]> {
    const response = await api.get<SavedReportConfig[]>('/reports/saved');
    return asArray(response.data);
  },

  async create(data: SavedReportCreate): Promise<SavedReportConfig> {
    const response = await api.post<SavedReportConfig>('/reports/saved', data);
    return response.data;
  },

  async update(id: string, data: SavedReportUpdate): Promise<SavedReportConfig> {
    const response = await api.patch<SavedReportConfig>(`/reports/saved/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/reports/saved/${id}`);
  },

  async runNow(id: string): Promise<ReportData> {
    const response = await api.post<ReportData>(`/reports/saved/${id}/run`);
    return response.data;
  },
};
