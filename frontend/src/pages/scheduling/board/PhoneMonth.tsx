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
import { useSignupWindow } from '../../../modules/scheduling/hooks/useSignupWindow';
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
}) => {
  const signupWindow = useSignupWindow();

  return (
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
              const summary = daySummary(shifts, currentUserId, signupWindow);
              const dimmed = isPastDay(day, today) || !dayMatchesFilter(summary, filter);
              const selected = isSameDay(day, selectedDate);

              // A past day, or one the filter excludes, reads quieter through
              // weight and through its bars — never by dimming the cell.
              //
              // Fading the whole cell was the obvious version and it cost this
              // grid three rounds of contrast bugs. Opacity multiplies the
              // date's contrast against the page behind it, so the strength of
              // the cue and the legibility of the text were one number:
              // `text-theme-text-primary` measured 2.92:1 at 45%, 5.57:1 at
              // 65% and 7.95:1 at 75%, against a 4.5:1 AA floor and 7:1 for
              // AAA. Every step that made the date safe made the cue weaker,
              // and anything under 7:1 also made the accessibility pass
              // date-dependent — axe declines to judge text it calls too
              // short, so a single-digit past day is never measured and a
              // two-digit one always is.
              //
              // Colour cannot carry it either, which is worth stating because
              // it is the first thing anyone reaches for. The text tokens are
              // all `#ffffff` in dark mode on purpose (see the AAA uplift note
              // in index.css): no tint of grey clears 7:1 against a 6%
              // surface, so a muted tier would be a no-op in one theme of the
              // three, and hardcoding a grey past the tokens re-introduces
              // exactly the failure that uplift removed. The surface tiers sit
              // within a hair of each other in every theme, so a background
              // tint is out for the same reason.
              //
              // What is left is what index.css already says dark mode uses:
              // size and weight. The date keeps full `text-primary` in every
              // theme, so it is no longer measured against the cue at all, and
              // the bars — decorative, with the legend carrying their meaning
              // in words — take an opacity no contrast rule applies to, which
              // is why they can be dimmed harder than the cell ever could be.
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  onClick={() => onSelect(day)}
                  className={`bg-theme-surface border-theme-surface-border flex min-h-[46px] flex-col items-center gap-[3px] rounded-md border px-0.5 py-1.5 ${
                    selected ? 'border-2 border-red-600 dark:border-red-500' : ''
                  }`}
                >
                  <span className={`text-theme-text-primary font-mono text-xs ${dimmed ? 'font-normal' : 'font-bold'}`}>
                    {day.getDate()}
                  </span>
                  {shifts.slice(0, MAX_BARS).map((shift) => (
                    <span
                      key={shift.id}
                      className={`h-1 w-[18px] rounded-full transition-opacity duration-200 ease-out ${
                        dimmed ? 'opacity-50' : ''
                      } ${STATUS_STYLES[shiftStatusInfo(shift, currentUserId, new Date(), signupWindow).status].bar}`}
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
};

export default PhoneMonth;
