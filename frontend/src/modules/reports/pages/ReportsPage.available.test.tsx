/**
 * Workflow review W72: the Reports page drew its cards from a fixed list and
 * never asked `/reports/available`, which is what drops a report the caller
 * lacks the source permission for (RPT-3). The chief was offered the Admin
 * Hours Report and refused on Generate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { getAvailableReports } = vi.hoisted(() => ({ getAvailableReports: vi.fn() }));

vi.mock('../services/api', () => ({
  reportsApiService: {
    generateReport: vi.fn(),
    getAvailableReports: (...args: unknown[]) => getAvailableReports(...args) as unknown,
  },
  savedReportsService: {},
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));

import { useReportsStore } from '../store/reportsStore';
import { ReportsPage } from './ReportsPage';
import { AdminHoursRenderer } from '../components/renderers/AdminHoursRenderer';

const catalogEntry = (id: string) => ({ id, title: id, description: '', category: 'member', available: true });

const renderPage = () =>
  render(
    <MemoryRouter>
      <ReportsPage />
    </MemoryRouter>
  );

describe('ReportsPage offers only what /available lists (W72)', () => {
  beforeEach(() => {
    getAvailableReports.mockReset();
    useReportsStore.setState({ availableReports: [], activeReportData: null, activeReportType: null, error: null });
  });

  it('hides a report the catalog leaves out for this caller', async () => {
    getAvailableReports.mockResolvedValue({
      available_reports: [catalogEntry('member_roster'), catalogEntry('training_summary')],
    });
    renderPage();

    expect(await screen.findByText('Member Roster')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByText('Admin Hours Report')).not.toBeInTheDocument());
  });

  it('shows a report the catalog lists', async () => {
    getAvailableReports.mockResolvedValue({
      available_reports: [catalogEntry('member_roster'), catalogEntry('admin_hours')],
    });
    renderPage();

    expect(await screen.findByText('Admin Hours Report')).toBeInTheDocument();
  });

  it('keeps every card when the catalog cannot be loaded', async () => {
    getAvailableReports.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByText('Admin Hours Report')).toBeInTheDocument();
    expect(screen.getByText('Member Roster')).toBeInTheDocument();
  });
});

describe('AdminHoursRenderer (W72)', () => {
  it('labels the entry method the way the admin-hours screens do', () => {
    render(
      <AdminHoursRenderer
        data={{
          report_type: 'admin_hours',
          generated_at: '2026-10-16T14:53:00Z',
          period_start: '2026-10-01',
          period_end: '2026-10-16',
          summary: { total_hours: 1, total_entries: 1, unique_members: 1, hours_by_category: { 'Station Duty': 1 } },
          entries: [
            {
              member_name: 'Jordan Avery',
              category_name: 'Station Duty',
              date: '2026-10-15',
              hours: 1,
              entry_method: 'qr_scan',
              status: 'pending',
            },
          ],
        }}
      />
    );

    expect(screen.getByText('QR Scan')).toBeInTheDocument();
  });
});
