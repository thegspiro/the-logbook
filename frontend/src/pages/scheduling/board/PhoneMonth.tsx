/**
 * The phone month grid: one cell per day, one bar per shift.
 *
 * There is no room for a chip's text at this width, so the colour carries the
 * whole message — which is why the legend under the grid is not optional, and
 * why the day sheet repeats the counts in words as soon as a day is tapped.
 */

import React from 'react';
import type { ShiftRecord } from '../../../modules/scheduling';
import {
  dayMatchesFilter,
  daySummary,
  isPastDay,
  isSameDay,
  shiftStatusInfo,
  toDateKey,
  weeksOf,
  type BoardFilter,
} from '../../../modules/scheduling/utils/shiftBoard';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { STATUS_STYLES, legendFor } from './statusStyles';

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Bars beyond this would shrink the cell below a comfortable tap target. */
const MAX_BARS = 3;

export interface PhoneMonthProps {
  days: Date[];
  visibleMonth: number | null;
  shiftsByDate: Map<string, ShiftRecord[]>;
  selectedDate: Date;
  currentUserId: string | null | undefined;
  filter: BoardFilter;
  today?: Date;
  /** Adds the "crew size not set" entry to the legend when it is in use. */
  hasUnsizedShift?: boolean;
  onSelect: (date: Date) => void;
}

export const PhoneMonth: React.FC<PhoneMonthProps> = ({
  days,
  visibleMonth,
  shiftsByDate,
  selectedDate,
  currentUserId,
  filter,
  today = new Date(),
  hasUnsizedShift = false,
  onSelect,
}) => (
  <div>
    {/* Same grid geometry as the day cells below, gap included, or the
        weekday initials stop lining up with their columns. */}
    <div className="mb-1 grid grid-cols-7 gap-0" aria-hidden="true">
      {WEEKDAY_INITIALS.map((label, index) => (
        <div key={index} className="text-theme-text-muted text-center text-[10px] font-bold">
          {label}
        </div>
      ))}
    </div>

    {/* A distinct name from the desktop grid: both are in the document at
        once and only CSS decides which is shown, so sharing one would give
        assistive tech two identically-named calendars.

        `gap-0` is load-bearing, not a default left un-set. Seven day cells
        have to clear the 44px touch minimum, and inside a 390px phone the
        grid only ever sees 317px of that — the page gutters, the card's
        padding and the scrollbar take the rest. That leaves 45.3px a cell
        with no gap and 41.9px at `gap-1`, which is what
        `mobile-presentation.spec.ts` fails on. Each cell carries its own
        border, so adjacent edges still read as a divider. Re-introducing a
        gap here means finding the width somewhere else first. */}
    <div className="grid grid-cols-7 gap-0" role="grid" aria-label="Month calendar, compact">
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

            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                aria-selected={selected}
                onClick={() => onSelect(day)}
                className={`bg-theme-surface border-theme-surface-border flex min-h-[46px] flex-col items-center gap-[3px] rounded-md border px-0.5 py-1.5 transition-opacity duration-200 ease-out ${
                  selected ? 'border-2 border-red-600 dark:border-red-500' : ''
                } ${dimmed ? 'opacity-45' : ''}`}
              >
                <span className="text-theme-text-primary font-mono text-xs font-bold">{day.getDate()}</span>
                {shifts.slice(0, MAX_BARS).map((shift) => (
                  <span
                    key={shift.id}
                    className={`h-1 w-[18px] rounded-full ${STATUS_STYLES[shiftStatusInfo(shift, currentUserId).status].bar}`}
                  />
                ))}
                <span className="sr-only">
                  {formatCalendarDate(key, { weekday: 'long', month: 'long', day: 'numeric' })}
                  {summary.shiftCount === 0
                    ? ', no shifts'
                    : `, ${summary.openSeats} open seat${summary.openSeats === 1 ? '' : 's'}`}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>

    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {legendFor(hasUnsizedShift).map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={`h-[5px] w-4 rounded-full ${STATUS_STYLES[status].bar}`} aria-hidden="true" />
          <span className="text-theme-text-secondary text-[11px]">{STATUS_STYLES[status].label}</span>
        </li>
      ))}
    </ul>
  </div>
);

export default PhoneMonth;
