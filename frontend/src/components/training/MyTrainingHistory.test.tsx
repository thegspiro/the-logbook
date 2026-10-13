import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTrainingHistory } from './MyTrainingHistory';
import type { MemberVisibility, MyTrainingHistoryPage } from '../../types/training';

const mockGetRecords = vi.fn();
const mockExport = vi.fn();

vi.mock('../../services/api', () => ({
  trainingModuleConfigService: {
    getMyTrainingRecords: (...args: unknown[]) => mockGetRecords(...args) as unknown,
    exportMyTraining: (...args: unknown[]) => mockExport(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

vi.mock('../../utils/dateFormatting', () => ({
  formatDate: (date: string | null) => date ?? 'N/A',
}));

const visibility = {
  show_training_history: true,
  show_training_hours: true,
  allow_member_report_export: false,
} as MemberVisibility;

const record = (id: string, name: string, date: string) => ({
  id,
  course_name: name,
  training_type: 'continuing_education',
  status: 'completed',
  completion_date: date,
  expiration_date: null,
  hours_completed: 1,
});

const YEARS = [
  { year: '2026', records: 2, hours: 2 },
  { year: '2025', records: 40, hours: 40 },
];

const pageFor = (year: string | undefined, search = '', page?: number): MyTrainingHistoryPage => {
  if (year === '2026') {
    return {
      items: [record('a', 'Sepsis', '2026-09-30'), record('b', 'Hematology', '2026-09-30')],
      total: 2,
      page: 1,
      page_size: 25,
      years: YEARS,
    };
  }
  if (year === '2025') {
    const items = Array.from({ length: 25 }, (_, i) =>
      record(`c${i}`, i === 0 ? 'Old class' : `Class ${i}`, '2025-03-01')
    );
    return { items, total: 40, page: page ?? 1, page_size: 25, years: YEARS };
  }
  return { items: [], total: search ? 0 : 42, page: 1, page_size: 1, years: search ? [] : YEARS };
};

const hoursSummary = { total_records: 42, total_hours: 42, completed_courses: 42 };

describe('MyTrainingHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecords.mockImplementation(
      (params: { year?: string; search?: string; page?: number }) =>
        Promise.resolve(pageFor(params.year, params.search, params.page)) as unknown
    );
    mockExport.mockResolvedValue(new Blob(['csv']));
  });

  it('opens the newest year and leaves older ones collapsed until asked', async () => {
    const user = userEvent.setup();
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);

    expect(await screen.findByText('Sepsis')).toBeInTheDocument();
    expect(screen.queryByText('Old class')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2025/ })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: /2025/ }));
    expect(await screen.findByText('Old class')).toBeInTheDocument();
    expect(mockGetRecords).toHaveBeenCalledWith(expect.objectContaining({ year: '2025', page: 1 }));
  });

  it('shows each year with its record count and hours', async () => {
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);
    const header = await screen.findByRole('button', { name: /2025/ });
    expect(within(header).getByText(/40 records/)).toBeInTheDocument();
    expect(within(header).getByText(/40 hrs/)).toBeInTheDocument();
  });

  it('offers to load the rest of a year that holds more than a page', async () => {
    const user = userEvent.setup();
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);
    await user.click(await screen.findByRole('button', { name: /2025/ }));
    expect(await screen.findByText('Showing 25 of 40')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show more/i }));
    await waitFor(() => {
      expect(mockGetRecords).toHaveBeenCalledWith(expect.objectContaining({ year: '2025', page: 2 }));
    });
  });

  it('searches by course name after the debounce and reloads the years', async () => {
    const user = userEvent.setup();
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);
    await screen.findByText('Sepsis');

    await user.type(screen.getByLabelText(/search courses/i), 'zzz');
    expect(await screen.findByText('No training records match.')).toBeInTheDocument();
    expect(mockGetRecords).toHaveBeenCalledWith(expect.objectContaining({ search: 'zzz' }));
  });

  it('hides the hours column and totals when the department hides hours', async () => {
    render(
      <MyTrainingHistory visibility={{ ...visibility, show_training_hours: false }} hoursSummary={hoursSummary} />
    );
    await screen.findByText('Sepsis');
    expect(screen.queryByRole('columnheader', { name: 'Hours' })).not.toBeInTheDocument();
    expect(screen.queryByText(/hrs/)).not.toBeInTheDocument();
    expect(screen.queryByText('All-time hours')).not.toBeInTheDocument();
  });

  it('exports the entire history, not just the filtered view', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    render(
      <MyTrainingHistory visibility={{ ...visibility, allow_member_report_export: true }} hoursSummary={hoursSummary} />
    );
    await user.click(await screen.findByRole('button', { name: /export pdf/i }));
    await waitFor(() => {
      expect(mockExport).toHaveBeenCalledWith('pdf');
    });
    vi.unstubAllGlobals();
  });

  it('reports a failed load instead of an empty history', async () => {
    mockGetRecords.mockRejectedValue(new Error('boom'));
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom|Failed to load/);
  });
});
