import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAvailableReports = vi.fn();
const mockGenerateReport = vi.fn();

vi.mock('../services/api', () => ({
  reportsApiService: {
    getAvailableReports: (...args: unknown[]) => mockGetAvailableReports(...args) as unknown,
    generateReport: (...args: unknown[]) => mockGenerateReport(...args) as unknown,
  },
  savedReportsService: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    runNow: vi.fn(),
  },
}));

import { useReportsStore, getPresetDates } from './reportsStore';

describe('getPresetDates', () => {
  it('returns this year dates', () => {
    const { start, end } = getPresetDates('this-year');
    const year = new Date().getFullYear();
    expect(start).toBe(`${year}-01-01`);
    expect(end).toBe(`${year}-12-31`);
  });

  it('returns last year dates', () => {
    const { start, end } = getPresetDates('last-year');
    const year = new Date().getFullYear() - 1;
    expect(start).toBe(`${year}-01-01`);
    expect(end).toBe(`${year}-12-31`);
  });

  it('returns last 90 days', () => {
    const { start, end } = getPresetDates('last-90');
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBeGreaterThanOrEqual(89);
    expect(diffDays).toBeLessThanOrEqual(91);
  });

  it('returns last 30 days', () => {
    const { start, end } = getPresetDates('last-30');
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
  });

  it('returns this quarter dates', () => {
    const { start, end } = getPresetDates('this-quarter');
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
  });

  it('returns last quarter dates', () => {
    const { start, end } = getPresetDates('last-quarter');
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
  });

  it('returns empty for custom preset', () => {
    const { start, end } = getPresetDates('custom');
    expect(start).toBe('');
    expect(end).toBe('');
  });
});

describe('useReportsStore', () => {
  beforeEach(() => {
    useReportsStore.setState({
      availableReports: [],
      availableReportsLoading: false,
      generatingReportType: null,
      activeReportData: null,
      activeReportType: null,
      datePreset: 'this-year',
      startDate: getPresetDates('this-year').start,
      endDate: getPresetDates('this-year').end,
      selectedCategory: 'all',
      savedReports: [],
      savedReportsLoading: false,
      comparisonData: null,
      comparisonPeriod: null,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('fetchAvailableReports', () => {
    it('sets available reports on success', async () => {
      const mockReports = [
        {
          id: 'member_roster',
          title: 'Member Roster',
          description: 'Test',
          category: 'member',
          available: true,
        },
      ];
      mockGetAvailableReports.mockResolvedValue({
        available_reports: mockReports,
      });

      await useReportsStore.getState().fetchAvailableReports();

      expect(useReportsStore.getState().availableReports).toEqual(mockReports);
      expect(useReportsStore.getState().availableReportsLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      mockGetAvailableReports.mockRejectedValue(new Error('Network error'));

      await useReportsStore.getState().fetchAvailableReports();

      expect(useReportsStore.getState().error).toBeTruthy();
      expect(useReportsStore.getState().availableReportsLoading).toBe(false);
    });
  });

  describe('generateReport', () => {
    it('sets active report data on success', async () => {
      const mockData = { report_type: 'member_roster', members: [] };
      mockGenerateReport.mockResolvedValue(mockData);

      const result = await useReportsStore.getState().generateReport({ report_type: 'member_roster' });

      expect(result).toEqual(mockData);
      expect(useReportsStore.getState().activeReportData).toEqual(mockData);
      expect(useReportsStore.getState().activeReportType).toBe('member_roster');
      expect(useReportsStore.getState().generatingReportType).toBeNull();
    });

    it('sets error on failure', async () => {
      mockGenerateReport.mockRejectedValue(new Error('Generation failed'));

      await expect(useReportsStore.getState().generateReport({ report_type: 'member_roster' })).rejects.toThrow(
        'Generation failed'
      );

      expect(useReportsStore.getState().error).toBeTruthy();
      expect(useReportsStore.getState().generatingReportType).toBeNull();
    });
  });

  describe('clearActiveReport', () => {
    it('clears active report state', () => {
      useReportsStore.setState({
        activeReportData: { report_type: 'test' },
        activeReportType: 'test',
        error: 'some error',
      });

      useReportsStore.getState().clearActiveReport();

      expect(useReportsStore.getState().activeReportData).toBeNull();
      expect(useReportsStore.getState().activeReportType).toBeNull();
      expect(useReportsStore.getState().error).toBeNull();
    });
  });

  describe('setDatePreset', () => {
    it('updates dates for non-custom presets', () => {
      useReportsStore.getState().setDatePreset('last-year');

      const year = new Date().getFullYear() - 1;
      expect(useReportsStore.getState().datePreset).toBe('last-year');
      expect(useReportsStore.getState().startDate).toBe(`${year}-01-01`);
      expect(useReportsStore.getState().endDate).toBe(`${year}-12-31`);
    });

    it('only sets preset for custom', () => {
      useReportsStore.getState().setDatePreset('custom');
      expect(useReportsStore.getState().datePreset).toBe('custom');
    });
  });

  describe('setCustomDates', () => {
    it('sets custom dates and switches to custom preset', () => {
      useReportsStore.getState().setCustomDates('2025-01-01', '2025-06-30');

      expect(useReportsStore.getState().datePreset).toBe('custom');
      expect(useReportsStore.getState().startDate).toBe('2025-01-01');
      expect(useReportsStore.getState().endDate).toBe('2025-06-30');
    });
  });

  describe('setSelectedCategory', () => {
    it('sets the category filter', () => {
      useReportsStore.getState().setSelectedCategory('training');
      expect(useReportsStore.getState().selectedCategory).toBe('training');
    });
  });

  describe('comparison', () => {
    it('stores comparison data and period', async () => {
      const mockData = { report_type: 'member_roster', members: [] };
      mockGenerateReport.mockResolvedValue(mockData);

      await useReportsStore.getState().generateComparisonReport({
        report_type: 'member_roster',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
      });

      expect(useReportsStore.getState().comparisonData).toEqual(mockData);
      expect(useReportsStore.getState().comparisonPeriod).toEqual({
        start: '2024-01-01',
        end: '2024-12-31',
      });
    });

    it('clears comparison data', () => {
      useReportsStore.setState({
        comparisonData: { report_type: 'test' },
        comparisonPeriod: { start: '2024-01-01', end: '2024-12-31' },
      });

      useReportsStore.getState().clearComparison();

      expect(useReportsStore.getState().comparisonData).toBeNull();
      expect(useReportsStore.getState().comparisonPeriod).toBeNull();
    });
  });
});
