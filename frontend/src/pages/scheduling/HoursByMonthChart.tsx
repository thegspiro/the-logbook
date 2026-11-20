/**
 * A member's year of shift hours as twelve stacked bars: the department's own
 * credited hours under the hours logged with other departments.
 *
 * Every figure comes straight off the hours-history months the summary cards
 * and the table read, so the chart cannot disagree with either. Pending hours
 * (a shift not yet closed out) are not drawn: they are in no total, and a bar
 * that later shrank at close-out would look like lost time.
 *
 * Each bar is a button. Hovering or focusing one shows its split, and choosing
 * one tells the parent, which opens that month in the shift list below.
 */

import React, { useMemo, useState } from 'react';
import type { MemberHoursMonth } from '../../modules/scheduling/services/api';
import { formatNumber } from '../../utils/dateFormatting';
import { formatHours } from '../../utils/hoursFormatting';
import { monthName, monthTotalHours } from './hoursMonths';

/** Plot height in pixels; bar heights are computed against it. */
const PLOT_HEIGHT = 176;

/** A round axis ceiling: the next multiple of ten above the busiest month, at least ten. */
const axisMax = (peak: number): number => Math.max(10, Math.ceil(peak / 10) * 10);

interface HoursByMonthChartProps {
  year: number;
  months: MemberHoursMonth[];
  departmentLabel: string;
  showCalls: boolean;
  /** 1-12, or null when no month is chosen. */
  selectedMonth: number | null;
  onSelectMonth: (month: number | null) => void;
}

export const HoursByMonthChart: React.FC<HoursByMonthChartProps> = ({
  year,
  months,
  departmentLabel,
  showCalls,
  selectedMonth,
  onSelectMonth,
}) => {
  const [hovered, setHovered] = useState<number | null>(null);

  const { max, busiest } = useMemo(() => {
    let peak: MemberHoursMonth | null = null;
    for (const m of months) {
      if (monthTotalHours(m) > 0 && (peak === null || monthTotalHours(m) > monthTotalHours(peak))) peak = m;
    }
    return { max: axisMax(peak ? monthTotalHours(peak) : 0), busiest: peak?.month ?? null };
  }, [months]);

  const ticks = [0, max / 2, max];
  const tipMonth = months.find((m) => m.month === hovered) ?? null;

  return (
    <div>
      <div className="text-theme-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-violet-600 dark:bg-violet-400" aria-hidden="true" />
          {departmentLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-600 dark:bg-sky-400" aria-hidden="true" />
          Other departments
        </span>
        <span className="text-theme-text-muted hidden text-xs sm:inline">Choose a month to see its shifts</span>
      </div>

      <div
        className="relative mt-4 grid grid-cols-[1.75rem_repeat(12,minmax(0,1fr))]"
        role="group"
        aria-label={`Hours by month, ${year}`}
      >
        {/* Y axis, then the row labels for the month and calls lines. */}
        <div className="flex flex-col" aria-hidden="true">
          <div className="relative" style={{ height: PLOT_HEIGHT }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="text-theme-text-muted absolute right-1.5 translate-y-1/2 text-[10px] leading-none"
                style={{ bottom: (t / max) * PLOT_HEIGHT }}
              >
                {formatNumber(t)}
              </span>
            ))}
          </div>
          <span className="mt-1.5 text-[11px] sm:text-xs">&nbsp;</span>
          {showCalls && <span className="text-theme-text-secondary text-[10px] font-semibold sm:text-xs">Calls</span>}
        </div>

        {months.map((m) => {
          const total = monthTotalHours(m);
          const external = m.external_hours ?? 0;
          const isSelected = selectedMonth === m.month;
          const dimmed = selectedMonth !== null && !isSelected;
          const label = `${monthName(m.month)}: ${formatHours(m.hours)} hours ${departmentLabel}, ${formatHours(external)} hours with other departments${showCalls ? `, ${formatNumber(m.calls + (m.external_calls ?? 0))} calls` : ''}`;
          return (
            <div key={m.month} className="flex min-w-0 flex-col items-center">
              <div
                className="border-theme-surface-border relative flex w-full items-end justify-center border-b"
                style={{ height: PLOT_HEIGHT }}
              >
                {ticks.slice(1).map((t) => (
                  <span
                    key={t}
                    className="border-theme-surface-border absolute inset-x-0 border-t border-dashed opacity-60"
                    style={{ bottom: (t / max) * PLOT_HEIGHT }}
                    aria-hidden="true"
                  />
                ))}
                {total > 0 ? (
                  <button
                    type="button"
                    className={`relative flex w-3/5 max-w-[2.75rem] flex-col-reverse rounded-t focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ${dimmed ? 'opacity-35' : ''}`}
                    style={{ height: (total / max) * PLOT_HEIGHT }}
                    aria-label={label}
                    aria-pressed={isSelected}
                    onClick={() => onSelectMonth(isSelected ? null : m.month)}
                    onMouseEnter={() => setHovered(m.month)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(m.month)}
                    onBlur={() => setHovered(null)}
                  >
                    {m.hours > 0 && (
                      <span
                        className={`block w-full bg-violet-600 dark:bg-violet-400 ${external > 0 ? '' : 'rounded-t'}`}
                        style={{ height: `${(m.hours / total) * 100}%` }}
                      />
                    )}
                    {external > 0 && (
                      <span
                        className="block w-full rounded-t bg-sky-600 dark:bg-sky-400"
                        style={{ height: `${(external / total) * 100}%` }}
                      />
                    )}
                    <span
                      className={`text-theme-text-secondary absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-[11px] font-semibold whitespace-nowrap ${
                        m.month === busiest || isSelected ? '' : 'hidden sm:block'
                      } ${m.month === busiest ? 'text-violet-700 dark:text-violet-300' : ''}`}
                      aria-hidden="true"
                    >
                      {formatHours(total)}
                    </span>
                  </button>
                ) : (
                  <span className="bg-theme-surface-border h-0.5 w-3/5 max-w-[2.75rem] rounded" aria-hidden="true" />
                )}
              </div>
              <span
                className={`mt-1.5 text-[11px] sm:text-xs ${isSelected ? 'font-bold text-violet-700 dark:text-violet-300' : 'text-theme-text-muted'}`}
                aria-hidden="true"
              >
                {monthName(m.month).slice(0, 3)}
              </span>
              {showCalls && (
                <span className="text-theme-text-secondary text-[11px] font-semibold sm:text-xs" aria-hidden="true">
                  {m.calls + (m.external_calls ?? 0) > 0 ? formatNumber(m.calls + (m.external_calls ?? 0)) : '–'}
                </span>
              )}
            </div>
          );
        })}

        {tipMonth && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 w-64 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
            // Centred over the month's column, held inside the chart so a
            // tooltip for January or December is not cut off at the card edge.
            style={{
              left: `clamp(8rem, calc(1.75rem + (100% - 1.75rem) * ${(tipMonth.month - 0.5) / 12}), calc(100% - 8rem))`,
            }}
          >
            <p className="mb-1 font-semibold">
              {monthName(tipMonth.month)} {year}
            </p>
            <p className="flex justify-between gap-3">
              <span>{departmentLabel}</span>
              <span className="font-semibold">
                {formatHours(tipMonth.hours)} hrs · {formatNumber(tipMonth.shifts)}{' '}
                {tipMonth.shifts === 1 ? 'shift' : 'shifts'}
              </span>
            </p>
            <p className="flex justify-between gap-3">
              <span>Other departments</span>
              <span className="font-semibold">
                {formatHours(tipMonth.external_hours ?? 0)} hrs · {formatNumber(tipMonth.external_shifts ?? 0)}{' '}
                {(tipMonth.external_shifts ?? 0) === 1 ? 'shift' : 'shifts'}
              </span>
            </p>
            {showCalls && (
              <p className="flex justify-between gap-3">
                <span>Calls</span>
                <span className="font-semibold">{formatNumber(tipMonth.calls + (tipMonth.external_calls ?? 0))}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
