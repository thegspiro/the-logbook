/**
 * Annual Training Report Renderer
 */

import React from 'react';
import type { AnnualTrainingEntry, AnnualTrainingReport } from '../../types';
import { toStr } from '../../utils/export';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';
import { formatHours, formatHoursExact, sumHoursToQuarter } from '@/utils/hoursFormatting';
import { leavePeriodText, leavePeriodsText } from '../../utils/leavePeriods';

/** "8 months", "1 month", "8.5 months": one decimal, trailing zero dropped. */
const monthsLabel = (months: number): string => {
  const n = Math.round(months * 10) / 10;
  return `${n} ${n === 1 ? 'month' : 'months'}`;
};

/**
 * A member's leave beside their hours, so a short year reads as a year away
 * rather than a shortfall. The months are the server's count, by the
 * department's rule; nothing here re-derives them.
 */
const LeaveCell: React.FC<{ entry: AnnualTrainingEntry }> = ({ entry }) => {
  const periods = entry.leave_periods ?? [];
  if (periods.length === 0) return <>-</>;
  return (
    <div className="text-right">
      <div>{monthsLabel(entry.leave_months ?? 0)}</div>
      {periods.map((period) => (
        <div key={`${period.start_date}-${period.end_date ?? ''}`} className="text-theme-text-muted text-xs">
          {leavePeriodText(period)}
        </div>
      ))}
    </div>
  );
};

interface Props {
  data: AnnualTrainingReport;
  formatRank?: (rank: string) => string;
}

export const AnnualTrainingRenderer: React.FC<Props> = ({ data, formatRank }) => {
  const { summary } = data;
  const entriesById = new Map(data.entries.map((entry) => [entry.member_id, entry]));

  const columns = [
    { key: 'member_name', header: 'Member' },
    {
      key: 'rank',
      header: 'Rank',
      render: (v: unknown) => (formatRank ? formatRank(toStr(v)) || '-' : toStr(v, '-')),
    },
    {
      key: 'training_hours',
      header: 'Training Hrs',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? formatHours(v) : toStr(v, '0')),
    },
    {
      key: 'shift_hours',
      header: 'Shift Hrs',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? formatHours(v) : toStr(v, '0')),
    },
    { key: 'courses_completed', header: 'Courses', align: 'right' as const },
    { key: 'shifts_completed', header: 'Shifts', align: 'right' as const },
    { key: 'calls_responded', header: 'Calls', align: 'right' as const },
    {
      key: 'leave_months',
      header: 'Leave',
      align: 'right' as const,
      render: (_v: unknown, row: Record<string, unknown>) => {
        const entry = entriesById.get(toStr(row.member_id));
        return entry ? <LeaveCell entry={entry} /> : '-';
      },
    },
    {
      key: 'avg_performance_rating',
      header: 'Rating',
      align: 'right' as const,
      render: (v: unknown) => toStr(v, '-'),
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Hours"
          value={formatHours(sumHoursToQuarter(data.entries.flatMap((e) => [e.training_hours, e.shift_hours])))}
        />
        <StatCard label="Completions" value={summary.total_completions} />
        <StatCard label="Calls Responded" value={summary.total_calls_responded} />
        <StatCard label="Avg Hours/Member" value={formatHoursExact(summary.avg_hours_per_member)} />
      </div>

      {Object.keys(summary.training_by_type).length > 0 && (
        <div className="mb-4">
          <p className="text-theme-text-muted mb-1 text-xs">By Training Type:</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.training_by_type).map(([type, count]) => (
              <span key={type} className="bg-theme-surface text-theme-text-secondary rounded-sm px-2 py-1 text-xs">
                {type.replace(/_/g, ' ')}: <span className="text-theme-text-primary font-semibold">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <ReportTable
        rows={data.entries as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No training data found for this period."
      />
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function getAnnualTrainingExportData(data: AnnualTrainingReport) {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'rank', header: 'Rank' },
    { key: 'training_hours', header: 'Training Hours' },
    { key: 'shift_hours', header: 'Shift Hours' },
    { key: 'courses_completed', header: 'Courses Completed' },
    { key: 'shifts_completed', header: 'Shifts Completed' },
    { key: 'calls_responded', header: 'Calls Responded' },
    { key: 'leave_months', header: 'Months on Leave' },
    { key: 'leave_periods_text', header: 'Leave Periods' },
    { key: 'avg_performance_rating', header: 'Avg Rating' },
  ];
  const rows = data.entries.map((entry) => ({
    ...entry,
    leave_months: entry.leave_months ?? 0,
    leave_periods_text: leavePeriodsText(entry.leave_periods),
  }));
  return { rows: rows as unknown as Array<Record<string, unknown>>, columns };
}
