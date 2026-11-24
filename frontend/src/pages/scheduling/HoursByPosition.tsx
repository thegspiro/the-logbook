/**
 * Hours by position — a member's credited shifts, cut by the seat they held.
 *
 * Shows the selected year or all time (owner decisions, 2026-11-23). The rows
 * are the server's own figures: credited department shifts per position,
 * shifts with no seat recorded last, and one row for time with other
 * departments taken from the same `external_*` totals the stat cards read, so
 * the rows add up to what the cards above them say. Nothing is re-derived here
 * (CLAUDE.md pitfall 29).
 *
 * A list rather than a table: each row reads as one sentence on a phone and to
 * a screen reader, with the bar beside it hidden from assistive technology
 * because the same hours are in the row's text.
 */

import React, { useState } from 'react';
import type { MemberHoursTotals, MemberPositionTotals } from '../../modules/scheduling/services/api';
import { positionLabel } from '../../modules/scheduling/utils/positionLabels';
import { formatNumber } from '../../utils/dateFormatting';
import { formatHours } from '../../utils/hoursFormatting';

interface HoursByPositionProps {
  idPrefix: string;
  year: number;
  positions: MemberPositionTotals[];
  allTimePositions: MemberPositionTotals[];
  /** The year's and all-time totals, for the outside-departments row. */
  totals: MemberHoursTotals;
  allTime: MemberHoursTotals;
  showCalls: boolean;
}

interface Row {
  key: string;
  label: string;
  shifts: number;
  hours: number;
  calls: number;
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export const HoursByPosition: React.FC<HoursByPositionProps> = ({
  idPrefix,
  year,
  positions,
  allTimePositions,
  totals,
  allTime,
  showCalls,
}) => {
  const [scope, setScope] = useState<'year' | 'all'>('year');
  const source = scope === 'year' ? positions : allTimePositions;
  const outside = scope === 'year' ? totals : allTime;

  const rows: Row[] = source.map((p) => ({
    key: p.position ?? '__none__',
    label: p.position ? positionLabel(p.position) : 'No position recorded',
    shifts: p.shifts,
    hours: p.hours,
    calls: p.calls,
  }));
  if ((outside.external_shifts ?? 0) > 0 || (outside.external_hours ?? 0) > 0) {
    rows.push({
      key: '__outside__',
      label: 'Other departments',
      shifts: outside.external_shifts ?? 0,
      hours: outside.external_hours ?? 0,
      calls: outside.external_calls ?? 0,
    });
  }
  const peak = Math.max(0, ...rows.map((r) => r.hours));
  const headingId = `${idPrefix}-positions-heading`;

  return (
    <section className="card p-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-theme-text-primary font-semibold">
          Hours by position
        </h4>
        <div role="group" aria-label="Period" className="flex gap-1">
          {(
            [
              ['year', String(year)],
              ['all', 'All time'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              className={scope === value ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setScope(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-theme-text-muted text-sm">Credited shifts, by the seat held.</p>

      {rows.length === 0 ? (
        <p className="text-theme-text-secondary mt-3 text-sm">
          No credited shifts {scope === 'year' ? `in ${year}` : 'yet'}.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-theme-text-primary font-medium">{row.label}</span>
                <span className="text-theme-text-secondary text-sm">
                  {formatHours(row.hours)} hrs · {plural(row.shifts, 'shift', 'shifts')}
                  {showCalls ? ` · ${plural(row.calls, 'call', 'calls')}` : ''}
                </span>
              </div>
              <div className="bg-theme-input-bg mt-1 h-2 w-full rounded-full" aria-hidden="true">
                <div
                  className={`h-2 rounded-full ${row.key === '__outside__' ? 'bg-amber-700' : 'bg-violet-600'}`}
                  style={{ width: peak > 0 ? `${(row.hours / peak) * 100}%` : '0%' }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
