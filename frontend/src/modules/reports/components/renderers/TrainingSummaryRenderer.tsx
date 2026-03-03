/**
 * Training Summary Report Renderer
 */

import React, { useState } from 'react';
import type { TrainingSummaryReport } from '../../types';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: TrainingSummaryReport;
}

type Tab = 'members' | 'courses' | 'requirements';

export const TrainingSummaryRenderer: React.FC<Props> = ({ data }) => {
  const [tab, setTab] = useState<Tab>('members');

  const memberColumns = [
    { key: 'member_name', header: 'Member' },
    { key: 'total_courses', header: 'Total Courses', align: 'right' as const },
    { key: 'completed_courses', header: 'Completed', align: 'right' as const },
    {
      key: 'total_hours',
      header: 'Hours',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? v.toFixed(1) : v != null ? String(v as string | number) : '0'),
    },
  ];

  const courseColumns = [
    { key: 'course_name', header: 'Course' },
    { key: 'total', header: 'Enrollments', align: 'right' as const },
    { key: 'completed', header: 'Completed', align: 'right' as const },
    {
      key: 'total_hours',
      header: 'Total Hours',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? v.toFixed(1) : v != null ? String(v as string | number) : '0'),
    },
  ];

  const reqColumns = [
    { key: 'requirement_name', header: 'Requirement' },
    { key: 'total_members', header: 'Total Members', align: 'right' as const },
    { key: 'completed', header: 'Completed', align: 'right' as const },
    {
      key: 'completion_pct',
      header: 'Completion %',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? `${v}%` : v != null ? String(v as string | number) : '0%'),
    },
  ];

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'members', label: 'By Member' },
    { id: 'courses', label: 'By Course' },
    { id: 'requirements', label: 'By Requirement' },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Courses" value={data.total_courses} />
        <StatCard label="Training Records" value={data.total_records} />
        <StatCard label="Completion Rate" value={`${data.completion_rate}%`} />
        <StatCard label="Members Tracked" value={data.entries.length} />
      </div>

      <div className="border-theme-surface-border mb-3 flex gap-2 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'text-theme-text-primary border-red-500'
                : 'text-theme-text-muted hover:text-theme-text-secondary border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'members' && (
        <ReportTable
          rows={data.entries as Array<Record<string, unknown>>}
          columns={memberColumns}
          emptyMessage="No training entries found."
        />
      )}
      {tab === 'courses' && (
        <ReportTable
          rows={(data.course_breakdown ?? []) as Array<Record<string, unknown>>}
          columns={courseColumns}
          emptyMessage="No course data found."
        />
      )}
      {tab === 'requirements' && (
        <ReportTable
          rows={(data.requirement_breakdown ?? []) as Array<Record<string, unknown>>}
          columns={reqColumns}
          emptyMessage="No requirement data found."
        />
      )}
    </div>
  );
};

export function getTrainingSummaryExportData(data: TrainingSummaryReport) {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'total_courses', header: 'Total Courses' },
    { key: 'completed_courses', header: 'Completed' },
    { key: 'total_hours', header: 'Hours' },
    { key: 'compliance_percentage', header: 'Compliance %' },
  ];
  return { rows: data.entries as Array<Record<string, unknown>>, columns };
}
