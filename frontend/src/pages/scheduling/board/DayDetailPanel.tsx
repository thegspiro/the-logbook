/**
 * The right-hand column of the board: your next shift, then the selected day.
 *
 * Everything it renders comes from the month fetch the calendar already made,
 * so selecting a day never waits on the network — the panel updates in place
 * as fast as the click lands.
 */

import React from 'react';
import { ArrowLeftRight, CalendarDays, Repeat } from 'lucide-react';
import type { ShiftRecord } from '../../../modules/scheduling';
import type { SwapRequest } from '../../../types/scheduling';
import { shiftCrewName, shiftPeriodLetter, toDateKey } from '../../../modules/scheduling/utils/shiftBoard';
import { formatCalendarDate, formatTime } from '../../../utils/dateFormatting';
import ShiftSeatList from './ShiftSeatList';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface DayDetailPanelProps {
  selectedDate: Date;
  shifts: ShiftRecord[];
  nextShift: ShiftRecord | null;
  currentUserId: string | null | undefined;
  timezone: string;
  eligibleByShift: Record<string, string[]>;
  pendingShiftId: string | null;
  onClaim: (shift: ShiftRecord, position: string | null) => void;
  onRelease: (shift: ShiftRecord, choice?: 'drop' | 'trade') => void;
  onOpenStanding: (shift: ShiftRecord) => void;
  /** Pending offers on the day's shifts, keyed by shift id. */
  offersToMe: Record<string, SwapRequest>;
  offersFromMe: Record<string, SwapRequest>;
  onAnswerOffer: (offer: SwapRequest, accept: boolean) => void;
  onCancelOffer: (offer: SwapRequest) => void;
}

const shiftLocation = (shift: ShiftRecord | null | undefined): string => {
  if (!shift) return '';
  const unit = shift.apparatus_unit_number ?? shift.apparatus_name;
  return unit ? `${unit}` : '';
};

export const DayDetailPanel: React.FC<DayDetailPanelProps> = ({
  selectedDate,
  shifts,
  nextShift,
  currentUserId,
  timezone,
  eligibleByShift,
  pendingShiftId,
  onClaim,
  onRelease,
  onOpenStanding,
  offersToMe,
  offersFromMe,
  onAnswerOffer,
  onCancelOffer,
}) => {
  // A calendar day belongs to no timezone: pushing one through a
  // timezone-aware formatter renders "Aug 26" as "Aug 25" for any viewer west
  // of the department, so the panel and the cell that opened it disagree.
  const heading = formatCalendarDate(toDateKey(selectedDate), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const weekdayName = WEEKDAY_NAMES[selectedDate.getDay()] ?? '';
  const units = Array.from(new Set(shifts.map(shiftLocation).filter(Boolean)));

  return (
    <div className="flex min-h-0 flex-col gap-5 lg:overflow-y-auto">
      {nextShift && (
        <section className="card shrink-0 border-l-4 border-l-blue-600 p-4 dark:border-l-blue-400">
          <p className="text-theme-text-muted text-[10px] font-bold tracking-[0.12em] uppercase">Your next shift</p>
          <p className="text-theme-text-primary mt-1 text-base font-bold">
            {formatCalendarDate(nextShift.shift_date, { weekday: 'short', month: 'short', day: 'numeric' })}
            {' · '}
            <span className="font-mono">
              {formatTime(nextShift.start_time, timezone)}
              {nextShift.end_time ? `–${formatTime(nextShift.end_time, timezone)}` : ''}
            </span>
          </p>
          <p className="text-theme-text-secondary mt-0.5 text-[13px]">
            {[shiftLocation(nextShift), shiftCrewName(nextShift, timezone)].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onRelease(nextShift)}
              className="btn-secondary min-h-[36px] justify-center rounded-lg px-2 text-sm"
            >
              Give up shift
            </button>
            <button
              type="button"
              onClick={() => onRelease(nextShift, 'trade')}
              className="btn-secondary inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg px-2 text-sm"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
              Offer trade
            </button>
          </div>
        </section>
      )}

      <section className="card shrink-0 overflow-hidden">
        <header className="border-theme-surface-border border-b px-4 py-3.5">
          <h3 className="text-theme-text-primary text-lg font-bold">{heading}</h3>
          <p className="text-theme-text-secondary text-[13px]">
            {shifts.length === 0
              ? 'No shifts scheduled'
              : [
                  `${shifts.length} shift${shifts.length === 1 ? '' : 's'}`,
                  ...(units.length > 0 ? [units.join(' · ')] : []),
                ].join(' · ')}
          </p>
        </header>

        {shifts.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <CalendarDays className="text-theme-text-muted mx-auto mb-2 h-8 w-8" aria-hidden="true" />
            <p className="text-theme-text-muted text-sm">Nothing on the roster for this day.</p>
          </div>
        ) : (
          shifts.map((shift) => {
            const isNight = shiftPeriodLetter(shift, timezone) === 'N';
            return (
              <div key={shift.id} className="border-theme-surface-border border-b px-4 py-3.5 last:border-b-0">
                <ShiftSeatList
                  shift={shift}
                  currentUserId={currentUserId}
                  timezone={timezone}
                  eligiblePositions={eligibleByShift[shift.id] ?? []}
                  pending={pendingShiftId === shift.id}
                  onClaim={onClaim}
                  onRelease={onRelease}
                  offerToMe={offersToMe[shift.id] ?? null}
                  offerFromMe={offersFromMe[shift.id] ?? null}
                  onAnswerOffer={onAnswerOffer}
                  onCancelOffer={onCancelOffer}
                />
                {/* The shortcut into a standing series. It opens the editor
                    rather than committing on a checkbox: the number of dates
                    a member is signing up for is the one fact they need to
                    see before agreeing to it. */}
                <button
                  type="button"
                  onClick={() => onOpenStanding(shift)}
                  className="text-theme-text-secondary mobile-touch-target mt-2.5 inline-flex items-center gap-1.5 text-xs hover:text-red-600 hover:underline dark:hover:text-red-400"
                >
                  <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                  Make this every {weekdayName} {isNight ? 'night' : 'day'}…
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
};

export default DayDetailPanel;
