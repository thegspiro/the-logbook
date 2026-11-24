/**
 * Hours by Position Report Renderer
 *
 * One row per member per seat held (owner decisions, 2026-11-24): the same
 * credited figures each member's own My Hours screen shows, with time on
 * other departments' apparatus as its own row. Every figure is the server's;
 * the Position filter narrows the table and reads that seat's total from the
 * report's own summary rather than adding rows up here (CLAUDE.md pitfall 29).
 */

import React, { useId, useMemo, useState } from 'react';
import type { PositionHoursReport } from '../../types';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';
import { formatHours } from '@/utils/hoursFormatting';
import { formatNumber } from '@/utils/dateFormatting';
import { positionHoursRow } from './positionHoursExport';

interface Props {
  data: PositionHoursReport;
}

const ALL = '';

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export const PositionHoursRenderer: React.FC<Props> = ({ data }) => {
  const filterId = useId();
  const [position, setPosition] = useState(ALL);
  const { summary } = data;

  const rows = useMemo(
    () => data.entries.filter((e) => position === ALL || e.position === position).map(positionHoursRow),
    [data.entries, position]
  );
  const chosen = summary.by_position.find((p) => p.position === position);

  const columns = [
    { key: 'member_name', header: 'Member' },
    { key: 'position', header: 'Position' },
    {
      key: 'hours',
      header: 'Hours',
      align: 'right' as const,
      render: (v: unknown) => (typeof v === 'number' ? formatHours(v) : '0'),
    },
    { key: 'shifts', header: 'Shifts', align: 'right' as const },
    { key: 'calls', header: 'Calls', align: 'right' as const },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Hours" value={formatHours(summary.total_hours)} />
        <StatCard label="Shifts" value={summary.total_shifts} />
        <StatCard label="Calls" value={summary.total_calls} />
        <StatCard label="Members" value={summary.members} />
      </div>

      {summary.by_position.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={filterId} className="form-label">
              Position
            </label>
            <select
              id={filterId}
              className="form-input w-56"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              <option value={ALL}>All positions</option>
              {summary.by_position.map((p) => (
                <option key={p.position} value={p.position}>
                  {p.position}
                </option>
              ))}
            </select>
          </div>
          {/* Always mounted: a live region added with its text is not read. */}
          <p className="text-theme-text-secondary pb-2 text-sm" aria-live="polite">
            {chosen
              ? `${chosen.position}: ${formatHours(chosen.hours)} hrs · ${plural(chosen.shifts, 'shift', 'shifts')} · ${plural(chosen.calls, 'call', 'calls')} · ${plural(chosen.members, 'member', 'members')}`
              : ''}
          </p>
        </div>
      )}

      {/* Keyed on the filter so a narrower list starts again at page one. */}
      <ReportTable key={position} rows={rows} columns={columns} emptyMessage="No credited shifts in this period." />
    </div>
  );
};
