/**
 * Admin Hours Report Renderer
 */

import React from 'react';
import type { AdminHoursReport } from '../../types';
import { toStr } from '../../utils/export';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: AdminHoursReport;
}

export const AdminHoursRenderer: React.FC<Props> = ({ data }) => {
  const { summary } = data;

  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'category_name', header: 'Category' },
    { key: 'date', header: 'Date' },
    {
      key: 'hours',
      header: 'Hours',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : toStr(v, '0')),
    },
    {
      key: 'entry_method',
      header: 'Method',
      render: (v: unknown) => <span className="capitalize">{toStr(v, '-').replace(/_/g, ' ')}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (v: unknown) => <span className="capitalize">{toStr(v, '-')}</span>,
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Total Hours" value={summary.total_hours} />
        <StatCard label="Entries" value={summary.total_entries} />
        <StatCard label="Members" value={summary.unique_members} />
      </div>

      {Object.keys(summary.hours_by_category).length > 0 && (
        <div className="mb-4">
          <p className="text-theme-text-muted mb-1 text-xs">By Category:</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.hours_by_category).map(([cat, hrs]) => (
              <span key={cat} className="bg-theme-surface text-theme-text-secondary rounded-sm px-2 py-1 text-xs">
                {cat}: <span className="text-theme-text-primary font-semibold">{hrs}h</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <ReportTable
        rows={data.entries as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No admin hours entries found for this period."
      />
    </div>
  );
};

export function getAdminHoursExportData(data: AdminHoursReport) {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'category_name', header: 'Category' },
    { key: 'date', header: 'Date' },
    { key: 'hours', header: 'Hours' },
    { key: 'entry_method', header: 'Method' },
    { key: 'status', header: 'Status' },
  ];
  return { rows: data.entries as Array<Record<string, unknown>>, columns };
}
