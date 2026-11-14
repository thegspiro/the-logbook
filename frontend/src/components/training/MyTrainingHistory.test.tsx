import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTrainingHistory } from './MyTrainingHistory';
import { TrainingRecordSource } from '../../constants/enums';
import type { MemberVisibility, MyTrainingHistoryPage, MyTrainingHistoryRecord } from '../../types/training';

const mockGetRecords = vi.fn();
const mockExport = vi.fn();

vi.mock('../../services/api', () => ({
  trainingModuleConfigService: {
    getMyTrainingRecords: (...args: unknown[]) => mockGetRecords(...args) as unknown,
    exportMyTraining: (...args: unknown[]) => mockExport(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

// The real module, so month headings render through formatCalendarDate;
// only the row dates are simplified to their raw value.
vi.mock('../../utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/dateFormatting')>()),
  formatDate: (date: string | null) => date ?? 'N/A',
}));

const visibility = {
  show_training_history: true,
  show_training_hours: true,
  allow_member_report_export: false,
} as MemberVisibility;

const record = (
  id: string,
  name: string,
  date: string,
  source: Pick<MyTrainingHistoryRecord, 'source' | 'source_label'> = {
    source: TrainingRecordSource.LOGBOOK,
    source_label: 'The Logbook',
  }
): MyTrainingHistoryRecord => ({
  id,
  course_name: name,
  training_type: 'continuing_education',
  status: 'completed',
  completion_date: date,
  expiration_date: null,
  hours_completed: 1,
  ...source,
});

const YEARS = [
  { year: '2026', records: 2, hours: 2 },
  { year: '2025', records: 40, hours: 40 },
];

const pageFor = (year: string | undefined, search = '', page?: number): MyTrainingHistoryPage => {
  if (year === '2026') {
    return {
      items: [
        record('a', 'Sepsis', '2026-09-30', {
          source: TrainingRecordSource.PROVIDER,
          source_label: 'Target Solutions',
        }),
        record('b', 'Hematology', '2026-09-30', { source: TrainingRecordSource.IMPORTED, source_label: 'Imported' }),
      ],
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

  it('says where each record came from', async () => {
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);
    await screen.findByText('Sepsis');

    expect(screen.getByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Sepsis/ })).getByText('Target Solutions')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Hematology/ })).getByText('Imported')).toBeInTheDocument();
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

  it('files undated records under their own group without calling them pending', async () => {
    const withUndated = [{ year: 'undated', records: 1, hours: 3 }, ...YEARS];
    mockGetRecords.mockImplementation(
      (params: { year?: string }) =>
        Promise.resolve(
          params.year === 'undated'
            ? {
                items: [{ ...record('u', 'Imported without a date', ''), completion_date: null }],
                total: 1,
                page: 1,
                page_size: 25,
                years: withUndated,
              }
            : { ...pageFor(params.year), years: withUndated }
        ) as unknown
    );
    const user = userEvent.setup();
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);

    const header = await screen.findByRole('button', { name: /No completion date/ });
    expect(screen.queryByText('Awaiting approval')).not.toBeInTheDocument();
    await user.click(header);
    const row = await screen.findByRole('row', { name: /Imported without a date/ });
    expect(within(row).getByText('Completed')).toBeInTheDocument();
  });

  // Workflow review W80-15: credit withdrawn because its event was deleted
  // read "Cancelled" with no explanation.
  it('says why an event withdrew a record’s credit', async () => {
    mockGetRecords.mockImplementation(
      (params: { year?: string }) =>
        Promise.resolve(
          params.year === '2026'
            ? {
                items: [
                  {
                    ...record('w', 'Hose Advancement', '2026-11-07'),
                    status: 'cancelled',
                    hours_completed: 0,
                    void_reason: "Credit withdrawn: removed from 'Past Hose Drill' attendance.",
                  },
                ],
                total: 1,
                page: 1,
                page_size: 25,
                years: YEARS,
              }
            : pageFor(params.year)
        ) as unknown
    );
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);

    const row = await screen.findByRole('row', { name: /Hose Advancement/ });
    expect(within(row).getByText("Credit withdrawn: removed from 'Past Hose Drill' attendance.")).toBeInTheDocument();
    expect(within(row).queryByText('voided')).not.toBeInTheDocument();
  });

  it('reports a failed load instead of an empty history', async () => {
    mockGetRecords.mockRejectedValue(new Error('boom'));
    render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom|Failed to load/);
  });

  describe('month headers', () => {
    const monthYears = [
      {
        year: '2026',
        records: 3,
        hours: 4.5,
        months: [
          { month: '2026-10', records: 2, hours: 3.5 },
          { month: '2026-03', records: 1, hours: 1 },
        ],
      },
    ];

    beforeEach(() => {
      mockGetRecords.mockReset();
      mockGetRecords.mockImplementation(
        (params: { year?: string }) =>
          Promise.resolve(
            params.year === '2026'
              ? {
                  // A page that ends part-way through October: the header
                  // must still carry October's full total from the server.
                  items: [record('x', 'Ladders', '2026-10-28'), record('y', 'Hazmat', '2026-03-02')],
                  total: 3,
                  page: 1,
                  page_size: 25,
                  years: monthYears,
                }
              : { items: [], total: 3, page: 1, page_size: 1, years: monthYears }
          ) as unknown
      );
    });

    it('heads each month with its full totals from the server, above its own rows', async () => {
      render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);

      const october = await screen.findByRole('rowheader', { name: /October 2026/ });
      expect(october).toHaveTextContent('October 2026· 2 records · 3.5 hrs');
      expect(screen.getByRole('rowheader', { name: /March 2026/ })).toHaveTextContent('March 2026· 1 record · 1 hrs');

      // Each month is its own row group, holding its header and its rows only.
      const groups = within(screen.getByRole('table'))
        .getAllByRole('rowgroup')
        .slice(1) // the thead
        .map((g) =>
          within(g)
            .getAllByRole('row')
            .map((r) => r.textContent ?? '')
        );
      expect(groups).toHaveLength(2);
      expect(groups[0]?.[0]).toContain('October 2026');
      expect(groups[0]?.slice(1).join()).toContain('Ladders');
      expect(groups[0]?.join()).not.toContain('Hazmat');
      expect(groups[1]?.[0]).toContain('March 2026');
      expect(groups[1]?.slice(1).join()).toContain('Hazmat');
    });

    it('leaves hours out of the month headers when the department hides hours', async () => {
      render(
        <MyTrainingHistory visibility={{ ...visibility, show_training_hours: false }} hoursSummary={hoursSummary} />
      );

      const october = await screen.findByRole('rowheader', { name: /October 2026/ });
      expect(october).toHaveTextContent('October 2026· 2 records');
      expect(october).not.toHaveTextContent('hrs');
    });

    it('keeps one header for a month that a "Show more" page continues', async () => {
      const user = userEvent.setup();
      mockGetRecords.mockImplementation(
        (params: { year?: string; page?: number }) =>
          Promise.resolve(
            params.year === '2026'
              ? {
                  items:
                    params.page === 2
                      ? [record('y', 'Pumps', '2026-10-02'), record('z', 'Hazmat', '2026-03-02')]
                      : [record('x', 'Ladders', '2026-10-28')],
                  total: 3,
                  page: params.page ?? 1,
                  page_size: 1,
                  years: monthYears,
                }
              : { items: [], total: 3, page: 1, page_size: 1, years: monthYears }
          ) as unknown
      );
      render(<MyTrainingHistory visibility={visibility} hoursSummary={hoursSummary} />);

      await screen.findByText('Ladders');
      await user.click(screen.getByRole('button', { name: 'Show more' }));
      await screen.findByText('Pumps');

      expect(screen.getAllByRole('rowheader', { name: /October 2026/ })).toHaveLength(1);
      expect(screen.getAllByRole('rowheader', { name: /March 2026/ })).toHaveLength(1);
    });
  });
});
