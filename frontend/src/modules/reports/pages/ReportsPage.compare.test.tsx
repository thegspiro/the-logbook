import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockExportReport = vi.fn();
const mockSaveFile = vi.fn();
vi.mock('../services/api', () => ({
  reportsApiService: {
    generateReport: vi.fn(),
    exportReport: (...args: unknown[]) => mockExportReport(...args) as unknown,
  },
  savedReportsService: {},
}));
vi.mock('@/utils/fileDownload', () => ({
  saveFile: (...args: unknown[]) => mockSaveFile(...args) as unknown,
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));

import { useReportsStore } from '../store/reportsStore';
import type { EventAttendanceReport } from '../types';
import { ReportsPage } from './ReportsPage';

const attendance: EventAttendanceReport = {
  report_type: 'event_attendance',
  generated_at: '2026-12-01T00:00:00Z',
  period_start: '2026-11-01',
  period_end: '2026-11-30',
  total_events: 0,
  average_attendance_rate: 0,
  events: [],
};

// Compare builds the previous period from this page's date picker. A saved
// report's run carries its own period, which the picker knows nothing about,
// so Compare there set a November report beside "the previous period" of
// whatever the picker held.
describe('ReportsPage Compare', () => {
  it("is not offered on a saved report's run", () => {
    useReportsStore.setState({
      generatingReportType: null,
      activeReportType: 'event_attendance',
      activeReportLabel: 'Monthly attendance',
      activeReportData: attendance,
      activeReportExport: { saved_report_id: 'saved-1' },
      comparisonData: null,
      generateReport: vi.fn(),
    });
    renderWithRouter(<ReportsPage />);

    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();
  });

  it('is offered on a report run from this page', () => {
    useReportsStore.setState({
      generatingReportType: null,
      activeReportType: 'event_attendance',
      activeReportLabel: null,
      activeReportData: attendance,
      activeReportExport: { report_type: 'event_attendance', start_date: '2026-11-01', end_date: '2026-11-30' },
      comparisonData: null,
      generateReport: vi.fn(),
    });
    renderWithRouter(<ReportsPage />);

    expect(screen.getByRole('button', { name: 'Compare' })).toBeInTheDocument();
  });
});
