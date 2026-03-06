/**
 * Apparatus/Fleet Status Report Renderer
 */

import React from 'react';
import type { ApparatusStatusReport } from '../../types';
import { toStr } from '../../utils/export';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: ApparatusStatusReport;
}

export const ApparatusStatusRenderer: React.FC<Props> = ({ data }) => {
  const columns = [
    { key: 'name', header: 'Apparatus' },
    { key: 'apparatus_type', header: 'Type' },
    {
      key: 'status',
      header: 'Status',
      render: (v: unknown) => {
        const s = toStr(v, 'unknown');
        const colors: Record<string, string> = {
          in_service: 'bg-green-500/20 text-green-300',
          out_of_service: 'bg-red-500/20 text-red-300',
          maintenance: 'bg-yellow-500/20 text-yellow-300',
          reserve: 'bg-blue-500/20 text-blue-300',
        };
        return (
          <span className={`rounded-sm px-2 py-0.5 text-xs capitalize ${colors[s] ?? 'bg-gray-500/20 text-gray-300'}`}>
            {s.replace(/_/g, ' ')}
          </span>
        );
      },
    },
    { key: 'station', header: 'Station' },
    { key: 'year', header: 'Year', align: 'right' as const },
    {
      key: 'mileage',
      header: 'Mileage',
      align: 'right' as const,
      render: (v: unknown) => (v != null ? Number(v).toLocaleString() : '-'),
    },
    { key: 'last_inspection_date', header: 'Last Inspection' },
    { key: 'next_inspection_due', header: 'Next Inspection' },
    {
      key: 'days_until_inspection',
      header: 'Days Until',
      align: 'right' as const,
      render: (v: unknown) => {
        if (v == null) return '-';
        const days = Number(v);
        const color =
          days < 0
            ? 'text-red-400 font-semibold'
            : days <= 30
              ? 'text-yellow-400 font-semibold'
              : 'text-theme-text-secondary';
        return <span className={color}>{days}</span>;
      },
    },
    { key: 'open_work_orders', header: 'Open WOs', align: 'right' as const },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Apparatus" value={data.total_apparatus} />
        <StatCard label="In Service" value={data.in_service_count} />
        <StatCard label="Out of Service" value={data.out_of_service_count} />
        <StatCard label="Maintenance Due" value={data.maintenance_due_count} />
      </div>
      <ReportTable
        rows={data.entries as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No apparatus records found."
      />
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function getApparatusStatusExportData(data: ApparatusStatusReport) {
  const columns = [
    { key: 'name', header: 'Apparatus' },
    { key: 'apparatus_type', header: 'Type' },
    { key: 'status', header: 'Status' },
    { key: 'station', header: 'Station' },
    { key: 'year', header: 'Year' },
    { key: 'mileage', header: 'Mileage' },
    { key: 'last_inspection_date', header: 'Last Inspection' },
    { key: 'next_inspection_due', header: 'Next Inspection' },
    { key: 'open_work_orders', header: 'Open Work Orders' },
  ];
  return { rows: data.entries as unknown as Array<Record<string, unknown>>, columns };
}
