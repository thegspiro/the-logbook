/**
 * Pipeline Overview Report Renderer
 */

import React from 'react';
import type { PipelineOverviewReport } from '../../types';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: PipelineOverviewReport;
}

export const PipelineOverviewRenderer: React.FC<Props> = ({ data }) => {
  const groupColumns = [
    { key: 'group_name', header: 'Group / Stage' },
    { key: 'prospect_count', header: 'Active' },
    {
      key: 'avg_days_in_group',
      header: 'Avg Days',
      render: (v: unknown) => (v != null ? String(v as string | number) : '—'),
    },
    {
      key: 'completion_rate',
      header: 'Completion %',
      render: (v: unknown) => (v != null ? `${String(v as string | number)}%` : '—'),
    },
  ];

  const prospectColumns = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    {
      key: 'status',
      header: 'Status',
      render: (v: unknown) => (
        <span className="capitalize">{v != null ? String(v as string | number) : '—'}</span>
      ),
    },
    { key: 'current_group', header: 'Current Group' },
    { key: 'current_stage', header: 'Current Stage' },
    { key: 'days_in_pipeline', header: 'Days in Pipeline' },
  ];

  return (
    <div>
      {/* Pipeline name */}
      <p className="text-theme-text-secondary mb-4 text-sm">
        Pipeline: <span className="font-medium">{data.pipeline_name}</span>
      </p>

      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Applicants" value={data.total_applicants} />
        <StatCard label="Active" value={data.active_applicants} />
        <StatCard label="Converted" value={data.converted_count} />
        <StatCard label="Rejected" value={data.rejected_count} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Withdrawn" value={data.withdrawn_count} />
        <StatCard label="On Hold" value={data.on_hold_count} />
        <StatCard label="Avg Days to Convert" value={data.avg_days_to_convert} />
      </div>

      {/* Stage groups table */}
      {data.groups.length > 0 && (
        <div className="mb-6">
          <h4 className="text-theme-text-primary mb-2 text-sm font-semibold">Stage Groups</h4>
          <ReportTable
            rows={data.groups as unknown as Array<Record<string, unknown>>}
            columns={groupColumns}
            emptyMessage="No stage groups configured."
          />
        </div>
      )}

      {/* Prospect detail table */}
      {data.prospects.length > 0 && (
        <div>
          <h4 className="text-theme-text-primary mb-2 text-sm font-semibold">Prospect Details</h4>
          <ReportTable
            rows={data.prospects as unknown as Array<Record<string, unknown>>}
            columns={prospectColumns}
            emptyMessage="No prospects found."
          />
        </div>
      )}
    </div>
  );
};

/** Flat rows and column definitions for export. */
// eslint-disable-next-line react-refresh/only-export-components
export function getPipelineOverviewExportData(data: PipelineOverviewReport) {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'status', header: 'Status' },
    { key: 'current_group', header: 'Current Group' },
    { key: 'current_stage', header: 'Current Stage' },
    { key: 'days_in_pipeline', header: 'Days in Pipeline' },
    { key: 'applied_at', header: 'Applied At' },
  ];
  return { rows: data.prospects as unknown as Array<Record<string, unknown>>, columns };
}
