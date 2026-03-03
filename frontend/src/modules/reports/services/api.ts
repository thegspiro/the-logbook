/**
 * Reports API Service
 *
 * Handles all report generation, saved report management, and export.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  AvailableReportsResponse,
  ReportData,
  ReportRequest,
  SavedReportConfig,
  SavedReportCreate,
  SavedReportUpdate,
} from '../types';

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
};

// ============================================================================
// Saved / Scheduled Reports
// ============================================================================

export const savedReportsService = {
  async list(): Promise<SavedReportConfig[]> {
    const response = await api.get<SavedReportConfig[]>('/reports/saved');
    return response.data;
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

// ============================================================================
// Export
// ============================================================================

export const reportExportService = {
  async exportReport(request: ReportRequest & { format: 'csv' | 'pdf' }): Promise<Blob> {
    const response = await api.post('/reports/export', request, {
      responseType: 'blob',
    });
    return response.data as Blob;
  },
};
