/**
 * The phone day sheet, and the confirmation that replaces it after a claim.
 *
 * The confirmation is a step rather than a toast because it is where the two
 * follow-on offers live — adding the shift to a calendar, and turning it into
 * a standing one — and a toast gives a member no time to take either.
 */

import React from 'react';
import { Calendar, Check, ChevronLeft, Info, Repeat } from 'lucide-react';
import type { ShiftRecord } from '../../../modules/scheduling';
import type { SwapRequest } from '../../../types/scheduling';
import { buildSeats, memberInitials, shiftCrewName, toDateKey } from '../../../modules/scheduling/utils/shiftBoard';
import { formatCalendarDate, formatTime } from '../../../utils/dateFormatting';
import ShiftSeatList from './ShiftSeatList';

export interface PhoneDaySheetProps {
  selectedDate: Date;
  shifts: ShiftRecord[];
  currentUserId: string | null | undefined;
  timezone: string;
  eligibleByShift: Record<string, string[]>;
  pendingShiftId: string | null;
  /** Set once a claim lands, switching the sheet to the confirmation. */
  confirmedShift: ShiftRecord | null;
  onClose: () => void;
  onClaim: (shift: ShiftRecord, position: string | null) => void;
  onRelease: (shift: ShiftRecord, choice?: 'drop' | 'trade') => void;
  onOpenStanding: (shift: ShiftRecord) => void;
  /** Pending offers on the day's shifts, keyed by shift id. */
  offersToMe: Record<string, SwapRequest>;
  offersFromMe: Record<string, SwapRequest>;
  onAnswerOffer: (offer: SwapRequest, accept: boolean) => void;
  onCancelOffer: (offer: SwapRequest) => void;
  onAddToCalendar: () => void;
  onDismissConfirmation: () => void;
  /** Open the full shift detail panel — editing, attendance, finalizing. */
  onViewShift?: ((shift: ShiftRecord) => void) | undefined;
}

export const PhoneDaySheet: React.FC<PhoneDaySheetProps> = ({
  selectedDate,
  shifts,
  currentUserId,
  timezone,
  eligibleByShift,
  pendingShiftId,
  confirmedShift,
  onClose,
  onClaim,
  onRelease,
  onOpenStanding,
  offersToMe,
  offersFromMe,
  onAnswerOffer,
  onCancelOffer,
  onAddToCalendar,
  onDismissConfirmation,
  onViewShift,
}) => {
  if (confirmedShift) {
    const crew = buildSeats(confirmedShift, currentUserId);
    const mySeat = crew.find((seat) => seat.isMine);
    return (
      <div className="pb-safe px-4 py-6 text-center">
        <span className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-green-200 bg-green-50 dark:border-green-500/40 dark:bg-green-500/10">
          <Check className="h-8 w-8 text-green-600 dark:text-green-400" aria-hidden="true" />
        </span>
        <h3 className="text-theme-text-primary text-[22px] font-bold">You&rsquo;re on the roster</h3>
        <p className="text-theme-text-secondary mx-auto mt-2 max-w-[320px] text-[15px] leading-[22px]">
          {formatCalendarDate(confirmedShift.shift_date, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}{' '}
          ·{' '}
          <span className="font-mono">
            {formatTime(confirmedShift.start_time, timezone)}
            {confirmedShift.end_time ? `–${formatTime(confirmedShift.end_time, timezone)}` : ''}
          </span>
          <br />
          {[confirmedShift.apparatus_unit_number ?? confirmedShift.apparatus_name, mySeat?.position?.replace(/_/g, ' ')]
            .filter(Boolean)
            .join(' · ')}
        </p>

        <section className="card mt-5 p-3 text-left">
          <p className="text-theme-text-muted mb-2 text-[10px] font-bold tracking-[0.12em] uppercase">
            Riding with you
          </p>
          <ul className="flex flex-col gap-1.5">
            {crew
              .filter((seat) => !seat.isMine)
              .map((seat, index) => (
                <li
                  key={seat.member?.assignment_id ?? `open-${index}`}
                  className={`flex items-center gap-2 text-[13px] ${seat.member ? '' : 'opacity-60'}`}
                >
                  <span
                    className={`bg-theme-surface-hover text-theme-text-secondary flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                      seat.member ? '' : 'border-theme-input-border border border-dashed bg-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    {seat.member ? memberInitials(seat.member.user_name) : '+'}
                  </span>
                  <span className="text-theme-text-primary min-w-0 truncate">
                    {seat.member?.user_name ?? 'Open seat'}
                  </span>
                  {seat.position && (
                    <span className="text-theme-text-muted ml-auto shrink-0 text-[11px] font-bold tracking-[0.08em] uppercase">
                      {seat.position.replace(/_/g, ' ')}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </section>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onAddToCalendar}
            className="btn-primary min-h-[48px] justify-center rounded-lg"
          >
            <Calendar className="mr-2 inline h-4 w-4" aria-hidden="true" />
            Add to my calendar
          </button>
          <button
            type="button"
            onClick={() => onOpenStanding(confirmedShift)}
            className="btn-secondary min-h-[48px] justify-center rounded-lg"
          >
            <Repeat className="mr-2 inline h-4 w-4" aria-hidden="true" />
            Make this a standing shift
          </button>
          <button
            type="button"
            onClick={onDismissConfirmation}
            className="text-theme-text-secondary mobile-touch-target text-sm hover:underline"
          >
            Back to the day
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-safe px-4 pb-4">
      <div className="mb-3 flex items-center gap-1">
        <button
          type="button"
          onClick={onClose}
          className="btn-icon text-theme-text-secondary -ml-2"
          aria-label="Back to the calendar"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h3 className="text-theme-text-primary truncate text-xl font-bold">
            {formatCalendarDate(toDateKey(selectedDate), { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          <p className="text-theme-text-secondary truncate text-xs">
            {shifts.length === 0
              ? 'No shifts scheduled'
              : Array.from(
                  new Set(shifts.map((s) => s.apparatus_unit_number ?? s.apparatus_name).filter(Boolean) as string[])
                ).join(' · ') || `${shifts.length} shift${shifts.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {shifts.length === 0 ? (
        <p className="text-theme-text-muted border-theme-surface-border rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          Nothing on the roster for this day.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {shifts.map((shift) => (
            <section key={shift.id} className="card overflow-hidden p-4">
              <p className="text-theme-text-muted mb-2 text-[10px] font-bold tracking-[0.12em] uppercase">
                {shiftCrewName(shift, timezone)}
              </p>
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
                variant="sheet"
              />
              {onViewShift && (
                <button
                  type="button"
                  onClick={() => onViewShift(shift)}
                  className="text-theme-text-secondary mobile-touch-target mt-2 inline-flex items-center gap-1.5 text-xs hover:text-red-600 hover:underline dark:hover:text-red-400"
                >
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  Shift details
                </button>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default PhoneDaySheet;
