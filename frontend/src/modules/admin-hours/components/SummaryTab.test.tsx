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

  it('requests presets through the end of the selected day', async () => {
    render(<SummaryTab />);

    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: '30-days' } });

    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
    expect(lastSummaryParams?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lastSummaryParams?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59\.999$/);
  });

  it('applies and validates a custom date range', () => {
    render(<SummaryTab />);

    fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-10' } });
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-03-01' } });
    expect(screen.getByRole('button', { name: 'Apply range' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' }));
    expect(fetchSummary).toHaveBeenLastCalledWith({
      startDate: '2026-03-10',
      endDate: '2026-03-31T23:59:59.999',
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
