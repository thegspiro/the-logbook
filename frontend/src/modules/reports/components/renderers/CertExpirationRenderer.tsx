/**
 * Certification Expiration Report Renderer
 */

import React from 'react';
import type { CertExpirationReport } from '../../types';
import { toStr } from '../../utils/export';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: CertExpirationReport;
}

const STATUS_COLORS: Record<string, string> = {
  expired: 'bg-red-500/20 text-red-300',
  expiring_soon: 'bg-yellow-500/20 text-yellow-300',
  valid: 'bg-green-500/20 text-green-300',
  no_expiry: 'bg-gray-500/20 text-gray-300',
};

const STATUS_LABELS: Record<string, string> = {
  expired: 'Expired',
  expiring_soon: 'Expiring Soon',
  valid: 'Valid',
  no_expiry: 'No Expiry',
};

export const CertExpirationRenderer: React.FC<Props> = ({ data }) => {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'rank', header: 'Rank' },
    { key: 'course_name', header: 'Certification' },
    { key: 'certification_number', header: 'Cert #' },
    { key: 'issuing_agency', header: 'Issuing Agency' },
    { key: 'completion_date', header: 'Completed' },
    { key: 'expiration_date', header: 'Expires' },
    {
      key: 'days_until_expiry',
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
    {
      key: 'expiry_status',
      header: 'Status',
      render: (v: unknown) => {
        const status = toStr(v, 'no_expiry');
        return (
          <span className={`rounded-sm px-2 py-0.5 text-xs ${STATUS_COLORS[status] ?? STATUS_COLORS.no_expiry}`}>
            {STATUS_LABELS[status] ?? status}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Certifications" value={data.total_certifications} />
        <StatCard label="Expired" value={data.expired_count} />
        <StatCard label="Expiring Soon" value={data.expiring_soon_count} />
        <StatCard label="Valid" value={data.valid_count} />
      </div>
      <ReportTable
        rows={data.entries as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No certification records found."
      />
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function getCertExpirationExportData(data: CertExpirationReport) {
  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'rank', header: 'Rank' },
    { key: 'course_name', header: 'Certification' },
    { key: 'certification_number', header: 'Cert #' },
    { key: 'issuing_agency', header: 'Issuing Agency' },
    { key: 'completion_date', header: 'Completed' },
    { key: 'expiration_date', header: 'Expires' },
    { key: 'days_until_expiry', header: 'Days Until Expiry' },
    { key: 'expiry_status', header: 'Status' },
  ];
  return { rows: data.entries as unknown as Array<Record<string, unknown>>, columns };
}
