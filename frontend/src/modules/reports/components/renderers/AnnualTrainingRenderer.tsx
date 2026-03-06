/**
 * Annual Training Report Renderer
 */

import React from 'react';
import type { AnnualTrainingReport } from '../../types';
import { toStr } from '../../utils/export';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: AnnualTrainingReport;
  formatRank?: (rank: string) => string;
}

export const AnnualTrainingRenderer: React.FC<Props> = ({ data, formatRank }) => {
  const { summary } = data;

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
      render: (v: unknown) => (typeof v === 'number' ? v.toFixed(1) : toStr(v, '0')),
    },
    {
      key: 'shift_hours',
      header: 'Shift Hrs',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? v.toFixed(1) : toStr(v, '0')),
    },
    { key: 'courses_completed', header: 'Courses', align: 'right' as const },
    { key: 'shifts_completed', header: 'Shifts', align: 'right' as const },
    { key: 'calls_responded', header: 'Calls', align: 'right' as const },
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
        <StatCard label="Total Hours" value={summary.total_combined_hours} />
        <StatCard label="Completions" value={summary.total_completions} />
        <StatCard label="Calls Responded" value={summary.total_calls_responded} />
        <StatCard label="Avg Hours/Member" value={summary.avg_hours_per_member} />
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
    { key: 'avg_performance_rating', header: 'Avg Rating' },
  ];
  return { rows: data.entries as unknown as Array<Record<string, unknown>>, columns };
}
