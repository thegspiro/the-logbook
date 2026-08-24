/**
 * The calendar itself — one button per day, one chip per shift.
 *
 * The chip carries the whole answer the page exists to give: a `D`/`N` letter,
 * a colour and a count. Nothing here opens a route or fetches anything;
 * selecting a day only moves the panel beside it.
 */

import React from 'react';
import type { ShiftRecord } from '../../../modules/scheduling';
import {
  chipLabel,
  dayMatchesFilter,
  daySummary,
  isPastDay,
  isSameDay,
  shiftPeriodLetter,
  shiftStatusInfo,
  toDateKey,
  weeksOf,
  type BoardFilter,
} from '../../../modules/scheduling/utils/shiftBoard';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { STATUS_STYLES } from './statusStyles';

const WEEKDAY_INITIALS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Chips beyond this are summarised, so a busy day cannot blow the row open. */
const MAX_VISIBLE_CHIPS = 3;

export interface MonthGridProps {
  days: Date[];
  /**
   * The month being shown, so padding days from the neighbouring months are
   * dropped. `null` keeps every day — what the week view needs, since its
   * seven days routinely straddle a month boundary.
   */
  visibleMonth: number | null;
  shiftsByDate: Map<string, ShiftRecord[]>;
  selectedDate: Date;
  currentUserId: string | null | undefined;
  timezone: string;
  filter: BoardFilter;
  today?: Date;
  onSelect: (date: Date) => void;
}

export const MonthGrid: React.FC<MonthGridProps> = ({
  days,
  visibleMonth,
  shiftsByDate,
  selectedDate,
  currentUserId,
  timezone,
  filter,
  today = new Date(),
  onSelect,
}) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="mb-1.5 grid grid-cols-7 gap-1.5" aria-hidden="true">
      {WEEKDAY_INITIALS.map((day) => (
        <div key={day} className="text-theme-text-muted text-center text-[10px] font-bold tracking-[0.12em] uppercase">
          {day}
        </div>
      ))}
    </div>

    <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-1.5" role="grid" aria-label="Month calendar">
      {/* A grid needs rows between it and its cells. `contents` supplies them
          to assistive tech without taking part in the CSS grid, so the cells
          still lay themselves out against the seven columns above. */}
      {weeksOf(days).map((week, index) => (
        <div key={`week-${index}`} role="row" className="contents">
          {week.map((day) => {
            const key = toDateKey(day);
            if (visibleMonth !== null && day.getMonth() !== visibleMonth) {
              return <div key={key} aria-hidden="true" />;
            }

            const shifts = shiftsByDate.get(key) ?? [];
            const summary = daySummary(shifts, currentUserId);
            const dimmed = isPastDay(day, today) || !dayMatchesFilter(summary, filter);
            const selected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, today);
            const visible = shifts.slice(0, MAX_VISIBLE_CHIPS);

            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                aria-current={isToday ? 'date' : undefined}
                aria-selected={selected}
                onClick={() => onSelect(day)}
                className={`card focus-visible:ring-theme-focus-ring flex min-h-[76px] cursor-pointer flex-col gap-1 overflow-hidden p-1.5 text-left transition-opacity duration-200 ease-out focus-visible:ring-2 focus-visible:outline-none ${
                  selected ? 'border-2 border-red-600 dark:border-red-500' : ''
                } ${dimmed ? 'opacity-35' : ''}`}
              >
                <span className="flex items-center gap-1">
                  <span
                    className={`font-mono text-[13px] font-bold ${
                      isToday
                        ? 'flex h-[22px] w-[22px] items-center justify-center rounded-full bg-red-600 text-white'
                        : 'text-theme-text-primary'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {summary.urgent && (
                    <span className="ml-auto text-[9px] font-bold tracking-[0.08em] text-red-700 dark:text-red-400">
                      URGENT
                    </span>
                  )}
                  <span className="sr-only">
                    {formatCalendarDate(key, { weekday: 'long', month: 'long', day: 'numeric' })}
                    {summary.shiftCount === 0
                      ? ', no shifts'
                      : `, ${summary.openSeats} open seat${summary.openSeats === 1 ? '' : 's'}`}
                  </span>
                </span>

                {visible.map((shift) => {
                  const info = shiftStatusInfo(shift, currentUserId);
                  return (
                    <span
                      key={shift.id}
                      className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[info.status].chip}`}
                    >
                      <span className="font-mono font-bold">{shiftPeriodLetter(shift, timezone)}</span>
                      <span className="truncate">{chipLabel(info)}</span>
                    </span>
                  );
                })}
                {shifts.length > MAX_VISIBLE_CHIPS && (
                  <span className="text-theme-text-muted text-[10px]">+{shifts.length - MAX_VISIBLE_CHIPS} more</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  </div>
);

export default MonthGrid;
