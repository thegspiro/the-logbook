/**
 * Call Volume / Incident Report Renderer
 */

import React from 'react';
import type { CallVolumeReport } from '../../types';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: CallVolumeReport;
}

export const CallVolumeRenderer: React.FC<Props> = ({ data }) => {
  const { summary } = data;

  const columns = [
    { key: 'date', header: 'Date' },
    { key: 'total_calls', header: 'Total Calls', align: 'right' as const },
    {
      key: 'by_type',
      header: 'Breakdown',
      sortable: false,
      render: (v: unknown) => {
        const types = v as Record<string, number> | undefined;
        if (!types || Object.keys(types).length === 0) return '-';
        return (
          <div className="flex flex-wrap gap-1">
            {Object.entries(types).map(([type, count]) => (
              <span key={type} className="bg-theme-surface rounded-sm px-1.5 py-0.5 text-xs">
                {type.replace(/_/g, ' ')}: {count}
              </span>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Calls" value={summary.total_calls} />
        <StatCard label="Avg Calls/Day" value={summary.avg_calls_per_day.toFixed(1)} />
        <StatCard label="Busiest Day" value={summary.busiest_day} />
        <StatCard label="Peak Calls" value={summary.busiest_day_count} />
      </div>

      {Object.keys(summary.by_type_totals).length > 0 && (
        <div className="mb-4">
          <p className="text-theme-text-muted mb-1 text-xs">By Call Type:</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.by_type_totals).map(([type, count]) => (
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
        emptyMessage="No call volume data found for this period."
      />
    </div>
  );
};

export function getCallVolumeExportData(data: CallVolumeReport) {
  // Flatten the by_type object into separate columns for CSV
  const allTypes = new Set<string>();
  for (const entry of data.entries) {
    for (const type of Object.keys(entry.by_type)) {
      allTypes.add(type);
    }
  }

  const typeColumns = [...allTypes].map((t) => ({
    key: `type_${t}`,
    header: t.replace(/_/g, ' '),
  }));

  const rows = data.entries.map((entry) => {
    const row: Record<string, unknown> = {
      date: entry.date,
      total_calls: entry.total_calls,
    };
    for (const t of allTypes) {
      row[`type_${t}`] = entry.by_type[t] ?? 0;
    }
    return row;
  });

  const columns = [{ key: 'date', header: 'Date' }, { key: 'total_calls', header: 'Total Calls' }, ...typeColumns];

  return { rows, columns };
}
