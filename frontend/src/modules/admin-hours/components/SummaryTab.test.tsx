import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminHoursSummary } from '../types';
import SummaryTab from './SummaryTab';

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

// Pin the department timezone so the UTC bounds below are stable regardless of
// the machine running the suite. America/New_York is UTC-4 on these March dates.
vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

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

  it('requests presets as UTC instants covering the whole selected day', async () => {
    render(<SummaryTab />);

    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: '30-days' } });

    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
    expect(lastSummaryParams?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(lastSummaryParams?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.999Z$/);
  });

  it('requests the current calendar year and displays a bounded reporting period', async () => {
    summary = {
      ...populatedSummary,
      // Bounds as the fetch actually sends them: reporting-day edges in
      // America/New_York converted to UTC instants.
      periodStart: '2026-01-01T05:00:00Z',
      periodEnd: '2026-08-15T03:59:59.999Z',
    };
    render(<SummaryTab />);

    expect(screen.getByText('Jan 1, 2026 – Aug 14, 2026')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: 'year' } });

    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
    // Jan 1 local in a UTC-5 zone is 05:00Z on Jan 1, not midnight Dec 31.
    expect(lastSummaryParams?.startDate).toMatch(/^\d{4}-01-01T05:00:00\.000Z$/);
    expect(lastSummaryParams?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.999Z$/);
  });

  it('renders the period label in the reporting timezone, not UTC', () => {
    summary = {
      ...populatedSummary,
      // The end bound is Mar 31 23:59:59.999 in America/New_York, which is
      // already Apr 1 in UTC — the label must still read Mar 31.
      periodStart: '2026-03-10T05:00:00Z',
      periodEnd: '2026-04-01T03:59:59.999Z',
    };
    render(<SummaryTab />);

    expect(screen.getByText('Mar 10, 2026 – Mar 31, 2026')).toBeInTheDocument();
  });

  it('applies and validates a custom date range', () => {
    render(<SummaryTab />);

    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-10' } });
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-03-01' } });
    expect(screen.getByRole('button', { name: 'Apply range' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' }));
    // UTC-4 on these dates: the range opens at 04:00Z on the 10th and closes a
    // millisecond before 04:00Z on April 1, so the whole 31st is included.
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

  it('renders loading and empty states', () => {
    summary = null;
    const { rerender } = render(<SummaryTab />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading summary');

    summary = { ...populatedSummary, totalHours: 0, totalEntries: 0, byCategory: [] };
    rerender(<SummaryTab />);
    expect(screen.getByText('No completed entries match this reporting period.')).toBeInTheDocument();
  });
});
