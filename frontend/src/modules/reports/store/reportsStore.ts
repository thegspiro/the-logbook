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
  ReportExportSource,
  ReportRequest,
  SavedReportConfig,
  SavedReportCreate,
  SavedReportUpdate,
} from '../types';
import { asArray } from '../../../utils/asArray';
import { getErrorMessage } from '../../../utils/errorHandling';
import { addCalendarDays, getTodayLocalDate } from '../../../utils/dateFormatting';

// ============================================================================
// Date preset helpers
// ============================================================================

// Built from the department's calendar date as plain Y-M-D arithmetic. A
// browser Date carried the browser's own day: a laptop on UTC with a New York
// department sent "this quarter" as Sep 30 – Dec 30, and "this year" turned
// over at the browser's New Year, not the department's.
const pad2 = (n: number): string => String(n).padStart(2, '0');
const lastDayOfMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const quarterRange = (year: number, quarter: number): { start: string; end: string } => {
  const firstMonth = quarter * 3 + 1;
  const lastMonth = firstMonth + 2;
  return {
    start: `${year}-${pad2(firstMonth)}-01`,
    end: `${year}-${pad2(lastMonth)}-${pad2(lastDayOfMonth(year, lastMonth))}`,
  };
};

export function getPresetDates(preset: DatePreset, tz?: string): { start: string; end: string } {
  const today = getTodayLocalDate(tz);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (preset) {
    case 'this-year':
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    case 'last-year':
      return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
    case 'last-90':
      return { start: addCalendarDays(today, -90), end: today };
    case 'last-30':
      return { start: addCalendarDays(today, -30), end: today };
    case 'this-quarter':
      return quarterRange(year, Math.floor((month - 1) / 3));
    case 'last-quarter': {
      const q = Math.floor((month - 1) / 3) - 1;
      return q < 0 ? quarterRange(year - 1, 3) : quarterRange(year, q);
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
  /** Set when the active report is a saved report's run: its name. */
  activeReportLabel: string | null;
  /**
   * What produced the active report, so a download re-runs that rather than
   * the date range the page shows now, which may have moved since.
   */
  activeReportExport: ReportExportSource | null;

  // Date range
  datePreset: DatePreset;
  startDate: string;
  endDate: string;

  // Category filter
  selectedCategory: string;

  // Saved reports
  savedReports: SavedReportConfig[];
  savedReportsLoading: boolean;
  /** Why the saved-reports list failed to load; null once it loads. */
  savedReportsError: string | null;

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
  runSavedReport: (report: SavedReportConfig) => Promise<ReportData>;

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
  activeReportLabel: null,
  activeReportExport: null,
  datePreset: 'this-year',
  startDate: initialDates.start,
  endDate: initialDates.end,
  selectedCategory: 'all',
  savedReports: [],
  savedReportsLoading: false,
  savedReportsError: null,
  comparisonData: null,
  comparisonPeriod: null,
  error: null,

  fetchAvailableReports: async () => {
    set({ availableReportsLoading: true, error: null });
    try {
      const data = await reportsApiService.getAvailableReports();
      // A degraded view (the report picker and title lookup), so a malformed
      // 200 renders as no reports rather than taking the page down.
      set({ availableReports: asArray(data?.available_reports), availableReportsLoading: false });
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
        activeReportLabel: null,
        activeReportExport: {
          report_type: request.report_type,
          start_date: request.start_date,
          end_date: request.end_date,
          filters: request.filters,
        },
        generatingReportType: null,
      });
      return data;
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to generate report');
      set({ generatingReportType: null, error: message });
      throw new Error(message, { cause: err });
    }
  },

  clearActiveReport: () => {
    set({
      activeReportData: null,
      activeReportType: null,
      activeReportLabel: null,
      activeReportExport: null,
      error: null,
    });
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
    set({ savedReportsLoading: true, savedReportsError: null });
    try {
      const data = await savedReportsService.list();
      set({ savedReports: data, savedReportsLoading: false });
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load saved reports');
      set({ savedReportsLoading: false, error: message, savedReportsError: message });
    }
  },

  createSavedReport: async (data: SavedReportCreate) => {
    try {
      const result = await savedReportsService.create(data);
      set({ savedReports: [...get().savedReports, result] });
      return result;
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Failed to create saved report') });
      throw err;
    }
  },

  updateSavedReport: async (id: string, data: SavedReportUpdate) => {
    try {
      const result = await savedReportsService.update(id, data);
      set({
        savedReports: get().savedReports.map((r) => (r.id === id ? result : r)),
      });
      return result;
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Failed to update saved report') });
      throw err;
    }
  },

  deleteSavedReport: async (id: string) => {
    try {
      await savedReportsService.delete(id);
      set({ savedReports: get().savedReports.filter((r) => r.id !== id) });
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Failed to delete saved report') });
      throw err;
    }
  },

  runSavedReport: async (report: SavedReportConfig) => {
    set({ generatingReportType: report.report_type, error: null });
    try {
      const data = await savedReportsService.runNow(report.id);
      set({
        activeReportData: data,
        activeReportType: report.report_type,
        activeReportLabel: report.name,
        // The server resolves a saved report's dates as Run did.
        activeReportExport: { saved_report_id: report.id },
        generatingReportType: null,
      });
      return data;
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to run saved report');
      set({ generatingReportType: null, error: message });
      throw new Error(message, { cause: err });
    }
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
