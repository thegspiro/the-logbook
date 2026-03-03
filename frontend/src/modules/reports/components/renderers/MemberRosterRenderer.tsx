/**
 * Member Roster Report Renderer
 */

import React from 'react';
import type { MemberRosterReport } from '../../types';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: MemberRosterReport;
}

export const MemberRosterRenderer: React.FC<Props> = ({ data }) => {
  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (_: unknown, row: Record<string, unknown>) =>
        `${row.first_name != null ? String(row.first_name as string) : ''} ${row.last_name != null ? String(row.last_name as string) : ''}`.trim(),
    },
    { key: 'email', header: 'Email' },
    { key: 'rank', header: 'Rank' },
    {
      key: 'status',
      header: 'Status',
      render: (v: unknown) => <span className="capitalize">{v != null ? String(v as string | number) : '-'}</span>,
    },
    { key: 'station', header: 'Station' },
    { key: 'membership_number', header: 'Member #' },
    {
      key: 'roles',
      header: 'Roles',
      render: (v: unknown) => (Array.isArray(v) ? v.join(', ') : v != null ? String(v as string | number) : '-'),
    },
    { key: 'joined_date', header: 'Joined' },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Total Members" value={data.total_members} />
        <StatCard label="Active" value={data.active_members} />
        <StatCard label="Inactive" value={data.inactive_members} />
      </div>
      <ReportTable
        rows={data.members as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No member records found."
      />
    </div>
  );
};

/** Flat rows and column definitions for export. */
export function getMemberRosterExportData(data: MemberRosterReport) {
  const columns = [
    { key: 'first_name', header: 'First Name' },
    { key: 'last_name', header: 'Last Name' },
    { key: 'email', header: 'Email' },
    { key: 'rank', header: 'Rank' },
    { key: 'status', header: 'Status' },
    { key: 'station', header: 'Station' },
    { key: 'membership_number', header: 'Member #' },
    { key: 'roles', header: 'Roles' },
    { key: 'joined_date', header: 'Joined' },
  ];
  return { rows: data.members as unknown as Array<Record<string, unknown>>, columns };
}
