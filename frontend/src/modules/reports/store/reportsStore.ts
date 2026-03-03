/**
 * Reports Zustand Store
 *
 * Manages report generation state, saved reports, and active report data.
 */

import { create } from 'zustand';
import { reportsApiService, savedReportsService } from '../services/api';
import type {
  AvailableReport,
  DatePreset,
  ReportData,
  ReportRequest,
  SavedReportConfig,
  SavedReportCreate,
  SavedReportUpdate,
} from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { toLocalDateString } from '../../../utils/dateFormatting';

// ============================================================================
// Date preset helpers
// ============================================================================

export function getPresetDates(preset: DatePreset, tz?: string): { start: string; end: string } {
  const now = new Date();
  switch (preset) {
    case 'this-year':
      return {
        start: `${now.getFullYear()}-01-01`,
        end: `${now.getFullYear()}-12-31`,
      };
    case 'last-year':
      return {
        start: `${now.getFullYear() - 1}-01-01`,
        end: `${now.getFullYear() - 1}-12-31`,
      };
    case 'last-90': {
      const ago = new Date(now);
      ago.setDate(ago.getDate() - 90);
      return { start: toLocalDateString(ago, tz), end: toLocalDateString(now, tz) };
    }
    case 'last-30': {
      const ago = new Date(now);
      ago.setDate(ago.getDate() - 30);
      return { start: toLocalDateString(ago, tz), end: toLocalDateString(now, tz) };
    }
    case 'this-quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const qStart = new Date(now.getFullYear(), q * 3, 1);
      const qEnd = new Date(now.getFullYear(), q * 3 + 3, 0);
      return {
        start: toLocalDateString(qStart, tz),
        end: toLocalDateString(qEnd, tz),
      };
    }
    case 'last-quarter': {
      const q = Math.floor(now.getMonth() / 3) - 1;
      const yr = q < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const qIdx = q < 0 ? 3 : q;
      const qStart = new Date(yr, qIdx * 3, 1);
      const qEnd = new Date(yr, qIdx * 3 + 3, 0);
      return {
        start: toLocalDateString(qStart, tz),
        end: toLocalDateString(qEnd, tz),
      };
    }
    default:
      return { start: '', end: '' };
  }
}

// ============================================================================
// Store interface
// ============================================================================

interface ReportsState {
  // Available reports metadata
  availableReports: AvailableReport[];
  availableReportsLoading: boolean;

  // Active report generation
  generatingReportType: string | null;
  activeReportData: ReportData | null;
  activeReportType: string | null;

  // Date range
  datePreset: DatePreset;
  startDate: string;
  endDate: string;

  // Category filter
  selectedCategory: string;

  // Saved reports
  savedReports: SavedReportConfig[];
  savedReportsLoading: boolean;

  // Comparison mode
  comparisonData: ReportData | null;
  comparisonPeriod: { start: string; end: string } | null;

  // Error
  error: string | null;

  // Actions
  fetchAvailableReports: () => Promise<void>;
  generateReport: (request: ReportRequest) => Promise<ReportData>;
  clearActiveReport: () => void;
  setDatePreset: (preset: DatePreset, tz?: string) => void;
  setCustomDates: (start: string, end: string) => void;
  setSelectedCategory: (category: string) => void;
  setError: (error: string | null) => void;

  // Saved reports actions
  fetchSavedReports: () => Promise<void>;
  createSavedReport: (data: SavedReportCreate) => Promise<SavedReportConfig>;
  updateSavedReport: (id: string, data: SavedReportUpdate) => Promise<SavedReportConfig>;
  deleteSavedReport: (id: string) => Promise<void>;

  // Comparison actions
  generateComparisonReport: (request: ReportRequest) => Promise<void>;
  clearComparison: () => void;
}

// ============================================================================
// Store
// ============================================================================

const initialDates = getPresetDates('this-year');

export const useReportsStore = create<ReportsState>((set, get) => ({
  availableReports: [],
  availableReportsLoading: false,
  generatingReportType: null,
  activeReportData: null,
  activeReportType: null,
  datePreset: 'this-year',
  startDate: initialDates.start,
  endDate: initialDates.end,
  selectedCategory: 'all',
  savedReports: [],
  savedReportsLoading: false,
  comparisonData: null,
  comparisonPeriod: null,
  error: null,

  fetchAvailableReports: async () => {
    set({ availableReportsLoading: true, error: null });
    try {
      const data = await reportsApiService.getAvailableReports();
      set({ availableReports: data.available_reports, availableReportsLoading: false });
    } catch (err: unknown) {
      set({
        availableReportsLoading: false,
        error: getErrorMessage(err, 'Failed to load available reports'),
      });
    }
  },

  generateReport: async (request: ReportRequest) => {
    set({ generatingReportType: request.report_type, error: null });
    try {
      const data = await reportsApiService.generateReport(request);
      set({
        activeReportData: data,
        activeReportType: request.report_type,
        generatingReportType: null,
      });
      return data;
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to generate report');
      set({ generatingReportType: null, error: message });
      throw new Error(message);
    }
  },

  clearActiveReport: () => {
    set({ activeReportData: null, activeReportType: null, error: null });
  },

  setDatePreset: (preset: DatePreset, tz?: string) => {
    if (preset !== 'custom') {
      const { start, end } = getPresetDates(preset, tz);
      set({ datePreset: preset, startDate: start, endDate: end });
    } else {
      set({ datePreset: preset });
    }
  },

  setCustomDates: (start: string, end: string) => {
    set({ datePreset: 'custom', startDate: start, endDate: end });
  },

  setSelectedCategory: (category: string) => {
    set({ selectedCategory: category });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  fetchSavedReports: async () => {
    set({ savedReportsLoading: true });
    try {
      const data = await savedReportsService.list();
      set({ savedReports: data, savedReportsLoading: false });
    } catch (err: unknown) {
      set({
        savedReportsLoading: false,
        error: getErrorMessage(err, 'Failed to load saved reports'),
      });
    }
  },

  createSavedReport: async (data: SavedReportCreate) => {
    const result = await savedReportsService.create(data);
    set({ savedReports: [...get().savedReports, result] });
    return result;
  },

  updateSavedReport: async (id: string, data: SavedReportUpdate) => {
    const result = await savedReportsService.update(id, data);
    set({
      savedReports: get().savedReports.map((r) => (r.id === id ? result : r)),
    });
    return result;
  },

  deleteSavedReport: async (id: string) => {
    await savedReportsService.delete(id);
    set({ savedReports: get().savedReports.filter((r) => r.id !== id) });
  },

  generateComparisonReport: async (request: ReportRequest) => {
    try {
      const data = await reportsApiService.generateReport(request);
      set({
        comparisonData: data,
        comparisonPeriod: {
          start: request.start_date ?? '',
          end: request.end_date ?? '',
        },
      });
    } catch (err: unknown) {
      set({
        error: getErrorMessage(err, 'Failed to generate comparison report'),
      });
    }
  },

  clearComparison: () => {
    set({ comparisonData: null, comparisonPeriod: null });
  },
}));
