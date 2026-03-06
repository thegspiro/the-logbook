/**
 * Event Attendance Report Renderer
 */

import React from 'react';
import type { EventAttendanceReport } from '../../types';
import { toStr } from '../../utils/export';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';

interface Props {
  data: EventAttendanceReport;
}

export const EventAttendanceRenderer: React.FC<Props> = ({ data }) => {
  const columns = [
    { key: 'event_title', header: 'Event' },
    { key: 'event_date', header: 'Date' },
    { key: 'total_rsvps', header: 'RSVPs', align: 'right' as const },
    { key: 'attended', header: 'Attended', align: 'right' as const },
    {
      key: 'attendance_rate',
      header: 'Attendance Rate',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? `${v.toFixed(1)}%` : toStr(v, '-')),
    },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Total Events" value={data.total_events} />
        <StatCard label="Avg Attendance Rate" value={`${data.average_attendance_rate}%`} />
        <StatCard label="Total Attended" value={data.events.reduce((sum, e) => sum + e.attended, 0)} />
      </div>
      <ReportTable
        rows={data.events as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No event attendance records found."
      />
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function getEventAttendanceExportData(data: EventAttendanceReport) {
  const columns = [
    { key: 'event_title', header: 'Event' },
    { key: 'event_date', header: 'Date' },
    { key: 'total_rsvps', header: 'RSVPs' },
    { key: 'attended', header: 'Attended' },
    { key: 'attendance_rate', header: 'Attendance Rate %' },
  ];
  return { rows: data.events as unknown as Array<Record<string, unknown>>, columns };
}
