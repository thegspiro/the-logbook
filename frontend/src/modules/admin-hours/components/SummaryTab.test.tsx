import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminHoursSummary } from '../types';

interface SummaryParams {
  startDate?: string;
  endDate?: string;
}

const fetchSummary = vi.fn<(params?: SummaryParams) => Promise<void>>();
let lastSummaryParams: SummaryParams | undefined;
let summary: AdminHoursSummary | null;

vi.mock('../store/adminHoursStore', () => ({
  useAdminHoursStore: (selector: (state: unknown) => unknown) => selector({ summary, fetchSummary }),
}));

// Fixed department timezone so the boundary conversions are deterministic:
// New York is UTC-5 (EST) in winter and UTC-4 (EDT) in summer.
vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

import SummaryTab from './SummaryTab';

const populatedSummary: AdminHoursSummary = {
  totalHours: 10,
  totalEntries: 4,
  approvedHours: 7,
  approvedEntries: 3,
  pendingHours: 3,
  pendingEntries: 1,
  periodStart: null,
  periodEnd: null,
  byCategory: [
    {
      categoryId: 'category-1',
      categoryName: 'Administration',
      categoryColor: '#2563eb',
      totalMinutes: 360,
      totalHours: 6,
      entryCount: 2,
    },
    {
      categoryId: 'category-2',
      categoryName: 'Community outreach',
      categoryColor: null,
      totalMinutes: 240,
      totalHours: 4,
      entryCount: 2,
    },
  ],
};

describe('SummaryTab', () => {
  beforeEach(() => {
    summary = populatedSummary;
    lastSummaryParams = undefined;
    fetchSummary.mockReset();
    fetchSummary.mockImplementation(async (params) => {
      lastSummaryParams = params;
    });
  });

  it('loads all-time data and explains the source of each total', () => {
    render(<SummaryTab />);

    expect(fetchSummary).toHaveBeenCalledWith({});
    expect(screen.getByText('All recorded time')).toBeInTheDocument();
    expect(screen.getByText('Counted hours')).toBeInTheDocument();
    expect(screen.getByText(/Active sessions, rejected entries, and deleted entries are excluded/)).toBeInTheDocument();
  });

  it('requests presets as UTC instants covering the org-local day boundaries', async () => {
    render(<SummaryTab />);

    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: '30-days' } });

    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
    // Start boundary: local midnight in America/New_York → 04:00 or 05:00 UTC.
    expect(lastSummaryParams?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T0[45]:00:00\.000Z$/);
    // End boundary: 1ms before the next local midnight, converted to UTC.
    expect(lastSummaryParams?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T0[34]:59:59\.999Z$/);
  });

  it('requests the current calendar year and displays a bounded reporting period', async () => {
    summary = {
      ...populatedSummary,
      // Jan 1 local midnight and Aug 14 end-of-day in America/New_York, as UTC.
      periodStart: '2026-01-01T05:00:00Z',
      periodEnd: '2026-08-15T03:59:59.999Z',
    };
    render(<SummaryTab />);

    // Rendered in the department's timezone, both ends land on the selected
    // local dates (Jan 1 – Aug 14), not the shifted UTC ones.
    expect(screen.getByText('Jan 1, 2026 – Aug 14, 2026')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: 'year' } });

    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
    // Jan 1 is always EST (UTC-5) → local midnight is 05:00Z.
    expect(lastSummaryParams?.startDate).toMatch(/^\d{4}-01-01T05:00:00\.000Z$/);
    expect(lastSummaryParams?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T0[34]:59:59\.999Z$/);
  });

  it('applies and validates a custom date range converted from the org timezone', () => {
    render(<SummaryTab />);

    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-10' } });
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-03-01' } });
    expect(screen.getByRole('button', { name: 'Apply range' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' }));
    // DST in 2026 starts Mar 8, so both boundaries are EDT (UTC-4): Mar 10
    // local midnight is 04:00Z, and the end of Mar 31 is 1ms before Apr 1
    // local midnight (04:00Z).
    expect(fetchSummary).toHaveBeenLastCalledWith({
      startDate: '2026-03-10T04:00:00.000Z',
      endDate: '2026-04-01T03:59:59.999Z',
    });
  });

  it('uses true total shares for category bars and exposes navigation actions', () => {
    const onNavigate = vi.fn();
    render(<SummaryTab onNavigate={onNavigate} />);

    expect(screen.getByRole('progressbar', { name: 'Administration: 60% of counted hours' })).toHaveAttribute(
      'aria-valuenow',
      '60'
    );

    fireEvent.click(screen.getByRole('button', { name: /Review now/ }));
    expect(onNavigate).toHaveBeenCalledWith('pending');
    fireEvent.click(screen.getByRole('button', { name: /View source entries/ }));
    expect(onNavigate).toHaveBeenCalledWith('all');
  });

  it('computes shares from exact minutes, not independently rounded hours', () => {
    summary = {
      ...populatedSummary,
      totalHours: 1.5,
      totalEntries: 2,
      byCategory: [
        {
          categoryId: 'category-1',
          categoryName: 'Administration',
          categoryColor: '#2563eb',
          totalMinutes: 50,
          totalHours: 0.8,
          entryCount: 1,
        },
        {
          categoryId: 'category-2',
          categoryName: 'Community outreach',
          categoryColor: null,
          totalMinutes: 40,
          totalHours: 0.7,
          entryCount: 1,
        },
      ],
    };
    render(<SummaryTab />);

    // 50 / 90 minutes = 55.6% → 56%. Dividing the rounded hours instead
    // (0.8 / 1.5) would show 53%.
    expect(screen.getByRole('progressbar', { name: 'Administration: 56% of counted hours' })).toHaveAttribute(
      'aria-valuenow',
      '56'
    );
    expect(screen.getByRole('progressbar', { name: 'Community outreach: 44% of counted hours' })).toHaveAttribute(
      'aria-valuenow',
      '44'
    );
  });

  it('renders loading and empty states', () => {
    summary = null;
    const { rerender } = render(<SummaryTab />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading summary');

    summary = { ...populatedSummary, totalHours: 0, totalEntries: 0, byCategory: [] };
    rerender(<SummaryTab />);
    expect(screen.getByText('No completed entries match this reporting period.')).toBeInTheDocument();
  });
});
