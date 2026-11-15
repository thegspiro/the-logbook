/**
 * The Annual Training report puts a member's leave beside their hours, so a
 * short year reads as a year away rather than a shortfall.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnnualTrainingRenderer, getAnnualTrainingExportData } from './AnnualTrainingRenderer';
import type { AnnualTrainingEntry, AnnualTrainingReport } from '../../types';

const entry = (overrides: Partial<AnnualTrainingEntry>): AnnualTrainingEntry => ({
  member_id: 'm1',
  member_name: 'Pat Member',
  training_hours: 4,
  courses_completed: 1,
  shift_hours: 0,
  shifts_completed: 0,
  calls_responded: 0,
  ...overrides,
});

const report = (entries: AnnualTrainingEntry[]): AnnualTrainingReport => ({
  report_type: 'annual_training',
  generated_at: '2026-10-21T00:00:00Z',
  period_start: '2026-01-01',
  period_end: '2026-12-31',
  year: 2026,
  summary: {
    total_members: entries.length,
    total_training_hours: 4,
    total_shift_hours: 0,
    total_combined_hours: 4,
    total_completions: 1,
    total_calls_responded: 0,
    avg_hours_per_member: 4,
    training_by_type: {},
  },
  entries,
});

const onLeave = entry({
  leave_months: 9,
  leave_periods: [{ start_date: '2025-07-01', end_date: '2026-09-01', excuses_training: true }],
});

describe('AnnualTrainingRenderer leave column', () => {
  it('shows the months on leave and the leave beside the hours', () => {
    render(<AnnualTrainingRenderer data={report([onLeave])} />);
    const row = screen.getByRole('row', { name: /Pat Member/ });
    expect(within(row).getByText('9 months')).toBeInTheDocument();
    expect(within(row).getByText('Jul 1, 2025 – Sep 1, 2026')).toBeInTheDocument();
  });

  it('says when an exempt leave kept the requirements in force', () => {
    const exempt = entry({
      leave_months: 0,
      leave_periods: [{ start_date: '2026-02-01', end_date: null, excuses_training: false }],
    });
    render(<AnnualTrainingRenderer data={report([exempt])} />);
    expect(screen.getByText('Feb 1, 2026 – no end date (requirements stayed in force)')).toBeInTheDocument();
    expect(screen.getByText('0 months')).toBeInTheDocument();
  });

  it('reads a dash for a member with no leave, and for a server that predates the column', () => {
    render(<AnnualTrainingRenderer data={report([entry({ leave_months: 0, leave_periods: [] })])} />);
    const row = screen.getByRole('row', { name: /Pat Member/ });
    expect(within(row).queryByText(/months?$/)).not.toBeInTheDocument();
  });

  it('exports the months and the periods as text', () => {
    const { rows, columns } = getAnnualTrainingExportData(report([onLeave, entry({ member_id: 'm2' })]));
    expect(columns.map((c) => c.header)).toEqual(expect.arrayContaining(['Months on Leave', 'Leave Periods']));
    expect(rows[0]).toMatchObject({ leave_months: 9, leave_periods_text: 'Jul 1, 2025 – Sep 1, 2026' });
    expect(rows[1]).toMatchObject({ leave_months: 0, leave_periods_text: '' });
  });
});
