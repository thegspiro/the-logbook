/**
 * Training Progress Report Renderer
 */

import React from 'react';
import type { TrainingProgressReport } from '../../types';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: TrainingProgressReport;
}

export const TrainingProgressRenderer: React.FC<Props> = ({ data }) => {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'program_name', header: 'Program' },
    {
      key: 'progress_percentage',
      header: 'Progress',
      align: 'center' as const,
      render: (v: unknown) => {
        const pct = Number(v ?? 0);
        const barColor = pct >= 75 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
        return (
          <div className="flex items-center gap-2">
            <div className="bg-theme-surface h-2 w-20 rounded-full">
              <div className={`${barColor} h-2 rounded-full`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs">{pct}%</span>
          </div>
        );
      },
    },
    {
      key: 'requirements_completed',
      header: 'Requirements',
      align: 'center' as const,
      render: (_: unknown, row: Record<string, unknown>) =>
        `${row.requirements_completed != null ? String(row.requirements_completed as string | number) : '0'} / ${row.requirements_total != null ? String(row.requirements_total as string | number) : '0'}`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (v: unknown) => {
        const s = v != null ? String(v as string | number) : 'unknown';
        const colors: Record<string, string> = {
          active: 'bg-green-500/20 text-green-300',
          completed: 'bg-blue-500/20 text-blue-300',
          expired: 'bg-red-500/20 text-red-300',
          withdrawn: 'bg-gray-500/20 text-gray-300',
        };
        return (
          <span className={`rounded-sm px-2 py-0.5 text-xs capitalize ${colors[s] ?? 'bg-gray-500/20 text-gray-300'}`}>
            {s}
          </span>
        );
      },
    },
    { key: 'enrolled_at', header: 'Enrolled' },
    { key: 'target_completion', header: 'Target Date' },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Enrollments" value={data.total_enrollments} />
        <StatCard label="Avg Progress" value={`${data.average_progress}%`} />
        <StatCard label="Active" value={data.status_summary.active ?? 0} />
        <StatCard label="Completed" value={data.status_summary.completed ?? 0} />
      </div>

      {Object.keys(data.status_summary).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(data.status_summary).map(([status, count]) => (
            <span key={status} className="bg-theme-surface text-theme-text-secondary rounded-sm px-2 py-1 text-xs">
              {status}: <span className="text-theme-text-primary font-semibold">{count}</span>
            </span>
          ))}
        </div>
      )}

      <ReportTable
        rows={data.entries as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No pipeline enrollments found."
      />
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function getTrainingProgressExportData(data: TrainingProgressReport) {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'program_name', header: 'Program' },
    { key: 'progress_percentage', header: 'Progress %' },
    { key: 'requirements_completed', header: 'Completed Reqs' },
    { key: 'requirements_total', header: 'Total Reqs' },
    { key: 'status', header: 'Status' },
    { key: 'enrolled_at', header: 'Enrolled At' },
    { key: 'target_completion', header: 'Target Date' },
  ];
  return { rows: data.entries as unknown as Array<Record<string, unknown>>, columns };
}
