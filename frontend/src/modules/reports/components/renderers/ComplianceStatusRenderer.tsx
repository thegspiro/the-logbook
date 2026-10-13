/**
 * Program Requirement Progress Report Renderer (report id `compliance_status`)
 *
 * RPT5-29-1: this report counts a requirement as met when the member's
 * training-program enrollment marked it complete. It is not the requirement
 * compliance the Training dashboard and compliance matrix report, so nothing
 * here is labelled "compliance" — the owner chose to relabel it rather than
 * change its numbers.
 */

import React from 'react';
import type { ComplianceStatusReport } from '../../types';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: ComplianceStatusReport;
}

export const ComplianceStatusRenderer: React.FC<Props> = ({ data }) => {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'rank', header: 'Rank' },
    {
      key: 'total_requirements',
      header: 'Total Reqs',
      align: 'right' as const,
    },
    {
      key: 'completed_requirements',
      header: 'Completed',
      align: 'right' as const,
    },
    {
      key: 'compliance_percentage',
      header: 'Program Progress',
      align: 'center' as const,
      render: (v: unknown) => {
        // Null: no requirement grades this member, so there is nothing to score.
        if (v === null || v === undefined) return <span className="text-theme-text-muted">N/A</span>;
        const pct = Number(v);
        const color =
          pct >= 100
            ? 'text-green-700 dark:text-green-400'
            : pct >= 75
              ? 'text-yellow-700 dark:text-yellow-400'
              : 'text-red-700 dark:text-red-400';
        return <span className={`font-semibold ${color}`}>{pct}%</span>;
      },
    },
    {
      key: 'overdue_items',
      header: 'Outstanding',
      render: (v: unknown) => {
        const items = Array.isArray(v) ? v : [];
        if (items.length === 0) return <span className="text-xs text-green-700 dark:text-green-400">None</span>;
        return <span className="text-xs text-red-700 dark:text-red-400">{items.join(', ')}</span>;
      },
    },
    {
      key: 'upcoming_deadlines',
      header: 'Upcoming Deadlines',
      render: (v: unknown) => {
        const items = Array.isArray(v) ? v : [];
        if (items.length === 0) return <span className="text-theme-text-muted text-xs">-</span>;
        return (
          <span className="text-xs">
            {items.map((d: { name: string; due_date: string }) => `${d.name} (${d.due_date})`).join(', ')}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Members" value={data.total_members} />
        <StatCard label="All Requirements Met" value={data.fully_compliant_count} />
        <StatCard label="Some Met" value={data.partially_compliant_count} />
        <StatCard label="None Met" value={data.non_compliant_count} />
        {(data.not_applicable_count ?? 0) > 0 && (
          <StatCard label="Not Applicable" value={data.not_applicable_count ?? 0} />
        )}
      </div>
      <p className="text-theme-text-secondary mb-3 text-sm">
        Progress through training-program enrollments. For requirement compliance, see the Training dashboard.
      </p>
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-theme-text-muted">Overall Program Progress:</span>
          <span className="text-theme-text-primary font-bold">
            {data.overall_compliance_rate === null ? 'N/A' : `${data.overall_compliance_rate}%`}
          </span>
        </div>
      </div>
      <ReportTable
        rows={data.entries as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No program progress found."
      />
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function getComplianceStatusExportData(data: ComplianceStatusReport) {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'rank', header: 'Rank' },
    { key: 'total_requirements', header: 'Total Requirements' },
    { key: 'completed_requirements', header: 'Completed' },
    { key: 'compliance_percentage', header: 'Program Progress %' },
    { key: 'overdue_items', header: 'Outstanding' },
  ];
  return { rows: data.entries as unknown as Array<Record<string, unknown>>, columns };
}
