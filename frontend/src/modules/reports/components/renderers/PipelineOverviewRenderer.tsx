/**
 * Pipeline Overview Report Renderer
 */

import React from 'react';
import type { PipelineOverviewReport } from '../../types';
import { toDisplayString } from '../../../../utils/displayValue';
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
      render: (v: unknown) => (v != null ? toDisplayString(v) : '—'),
    },
    {
      key: 'completion_rate',
      header: 'Completion %',
      render: (v: unknown) => (v != null ? `${toDisplayString(v)}%` : '—'),
    },
  ];

  const prospectColumns = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    {
      key: 'status',
      header: 'Status',
      render: (v: unknown) => <span className="capitalize">{v != null ? toDisplayString(v) : '—'}</span>,
    },
    { key: 'current_group', header: 'Current Group' },
    { key: 'current_stage', header: 'Current Stage' },
    { key: 'days_in_pipeline', header: 'Days in Pipeline' },
  ];

  const yearlyColumns = [
    { key: 'year', header: 'Application Year' },
    { key: 'applicants', header: 'Applicants' },
    {
      key: 'applicant_growth_percent',
      header: 'YoY Growth',
      render: (v: unknown) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${v}%` : '—'),
    },
    { key: 'converted', header: 'Converted' },
    { key: 'rejected', header: 'Rejected' },
    {
      key: 'conversion_rate',
      header: 'Decision Conversion',
      render: (v: unknown) => `${toDisplayString(v)}%`,
    },
    { key: 'avg_days_to_convert', header: 'Avg Days' },
  ];

  const referralColumns = [
    { key: 'source', header: 'Referral Source' },
    { key: 'applicants', header: 'Applicants' },
    { key: 'converted', header: 'Converted' },
    {
      key: 'conversion_rate',
      header: 'Applicant Conversion',
      render: (v: unknown) => `${toDisplayString(v)}%`,
    },
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
        <StatCard label="Decision Conversion" value={`${data.conversion_rate}%`} />
      </div>

      {data.yearly_trends.length > 0 && (
        <div className="mb-6">
          <h4 className="text-theme-text-primary mb-2 text-sm font-semibold">Year-over-Year Trends</h4>
          <ReportTable
            rows={data.yearly_trends as unknown as Array<Record<string, unknown>>}
            columns={yearlyColumns}
            emptyMessage="No annual trend data available."
          />
        </div>
      )}

      {data.referral_sources.length > 0 && (
        <div className="mb-6">
          <h4 className="text-theme-text-primary mb-2 text-sm font-semibold">Applicant Sources</h4>
          <ReportTable
            rows={data.referral_sources as unknown as Array<Record<string, unknown>>}
            columns={referralColumns}
            emptyMessage="No referral-source data available."
          />
        </div>
      )}

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
