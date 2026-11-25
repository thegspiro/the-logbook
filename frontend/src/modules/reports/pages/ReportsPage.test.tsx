import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { ReportsPage } from './ReportsPage';

const mockGenerateReport = vi.fn();

// Member Roster is the first card, so its button is the first of its label.
const firstButton = (name: string | RegExp): HTMLElement => {
  const button = screen.getAllByRole('button', { name })[0];
  if (!button) throw new Error(`No button named ${String(name)}`);
  return button;
};

// The button used to be `disabled` while its report generated. A disabled
// button drops focus to <body>, so the results dialog recorded <body> as its
// opener and closing it left a keyboard user at the top of the page.
describe('ReportsPage generate button', () => {
  beforeEach(() => {
    mockGenerateReport.mockReset();
    mockGenerateReport.mockResolvedValue(undefined);
    useReportsStore.setState({
      generatingReportType: null,
      activeReportData: null,
      activeReportType: null,
      generateReport: mockGenerateReport,
    });
  });

  it('stays focusable while generating and ignores a second press', async () => {
    const user = userEvent.setup();
    useReportsStore.setState({ generatingReportType: 'member_roster' });
    renderWithRouter(<ReportsPage />);

    const button = firstButton(/generating/i);

    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');

    button.focus();
    await user.click(button);
    expect(button).toHaveFocus();
    expect(mockGenerateReport).not.toHaveBeenCalled();
  });

  it('generates the report when not busy', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReportsPage />);

    await user.click(firstButton('Generate Report'));

    expect(mockGenerateReport).toHaveBeenCalledWith(expect.objectContaining({ report_type: 'member_roster' }));
  });
});

// Each report's export helper returns the report's own list as its rows, and
// each renderer reads its report's own shape. A body without that shape took
// the whole page down ("reading 'length'"); it now stays inside the dialog.
describe('ReportsPage with a report body it cannot read', () => {
  const REPORT_TYPES = [
    'member_roster',
    'training_summary',
    'event_attendance',
    'training_progress',
    'annual_training',
    'admin_hours',
    'position_hours',
    'department_overview',
    'certification_expiration',
    'apparatus_status',
    'inventory_status',
    'compliance_status',
    'call_volume',
    'pipeline_overview',
  ];

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each(REPORT_TYPES)('%s says it could not be read and offers nothing to export', (reportType) => {
    useReportsStore.setState({
      generatingReportType: null,
      activeReportType: reportType,
      activeReportData: {} as never,
      generateReport: vi.fn(),
    });
    renderWithRouter(<ReportsPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("This report's data could not be read.");
    const enabledExports = screen
      .queryAllByRole('button', { name: /^(CSV|PDF)$/ })
      .filter((button) => !(button as HTMLButtonElement).disabled);
    expect(enabledExports).toEqual([]);
  });
});

describe('ReportsPage downloads', () => {
  const roster = {
    report_type: 'member_roster',
    total_members: 1,
    active_members: 1,
    inactive_members: 0,
    members: [{ first_name: 'Pat', last_name: 'Lee', roles: [] }],
  };

  beforeEach(() => {
    mockExportReport.mockReset();
    mockExportReport.mockResolvedValue({ blob: new Blob(['%PDF']), filename: 'member_roster_2026-11-15.pdf' });
    mockSaveFile.mockReset();
  });

  it('downloads the report on screen, not the date range the page shows now', async () => {
    const user = userEvent.setup();
    useReportsStore.setState({
      generatingReportType: null,
      activeReportType: 'member_roster',
      activeReportLabel: null,
      activeReportData: roster as never,
      activeReportExport: { report_type: 'member_roster', start_date: '2026-01-01', end_date: '2026-06-30' },
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      generateReport: vi.fn(),
    });
    renderWithRouter(<ReportsPage />);

    await user.click(screen.getByRole('button', { name: 'PDF' }));

    expect(mockExportReport).toHaveBeenCalledWith(
      { report_type: 'member_roster', start_date: '2026-01-01', end_date: '2026-06-30' },
      'pdf',
      'member_roster.pdf'
    );
    const saved = mockSaveFile.mock.calls[0]?.[0] as { blob: unknown; filename: string } | undefined;
    expect(saved?.blob).toBeInstanceOf(Blob);
    expect(saved?.filename).toBe('member_roster_2026-11-15.pdf');
  });

  it("downloads a saved report by its id, under the saved report's name", async () => {
    const user = userEvent.setup();
    useReportsStore.setState({
      generatingReportType: null,
      activeReportType: 'member_roster',
      activeReportLabel: 'Q1 Roster',
      activeReportData: roster as never,
      activeReportExport: { saved_report_id: 'saved-1' },
      generateReport: vi.fn(),
    });
    renderWithRouter(<ReportsPage />);

    await user.click(screen.getByRole('button', { name: 'CSV' }));

    expect(mockExportReport).toHaveBeenCalledWith({ saved_report_id: 'saved-1' }, 'csv', 'q1_roster.csv');
  });
});
