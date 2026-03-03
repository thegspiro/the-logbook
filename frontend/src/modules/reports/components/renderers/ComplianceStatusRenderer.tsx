/**
 * Compliance Status Report Renderer
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
      header: 'Compliance',
      align: 'center' as const,
      render: (v: unknown) => {
        const pct = Number(v ?? 0);
        const color = pct >= 100 ? 'text-green-400' : pct >= 75 ? 'text-yellow-400' : 'text-red-400';
        return <span className={`font-semibold ${color}`}>{pct}%</span>;
      },
    },
    {
      key: 'overdue_items',
      header: 'Overdue Items',
      render: (v: unknown) => {
        const items = Array.isArray(v) ? v : [];
        if (items.length === 0) return <span className="text-xs text-green-400">None</span>;
        return <span className="text-xs text-red-400">{items.join(', ')}</span>;
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
        <StatCard label="Fully Compliant" value={data.fully_compliant_count} />
        <StatCard label="Partially Compliant" value={data.partially_compliant_count} />
        <StatCard label="Non-Compliant" value={data.non_compliant_count} />
      </div>
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-theme-text-muted">Overall Compliance Rate:</span>
          <span className="text-theme-text-primary font-bold">{data.overall_compliance_rate}%</span>
        </div>
      </div>
      <ReportTable
        rows={data.entries as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No compliance data found."
      />
    </div>
  );
};

export function getComplianceStatusExportData(data: ComplianceStatusReport) {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'rank', header: 'Rank' },
    { key: 'total_requirements', header: 'Total Requirements' },
    { key: 'completed_requirements', header: 'Completed' },
    { key: 'compliance_percentage', header: 'Compliance %' },
    { key: 'overdue_items', header: 'Overdue Items' },
  ];
  return { rows: data.entries as unknown as Array<Record<string, unknown>>, columns };
}
