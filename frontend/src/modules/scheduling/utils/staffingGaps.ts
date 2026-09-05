/**
 * Which upcoming shifts are short, and which seats are empty on them.
 *
 * Built on `shiftBoard.ts` rather than beside it. The month grid, the day panel
 * and the phone sheet already agree about what a shift needs, and a second
 * answer here is exactly how three screens come to disagree about one shift —
 * so capacity, the seat list and "who counts as seated" all come from there.
 *
 * One thing is deliberately different, and it is the reason this file exists:
 * **openness is judged for an officer, not for a member.** `shiftStatusInfo`
 * zeroes a shift's open seats once the member signup window has closed, which
 * is right for a board offering a claim button — nothing a member browsing can
 * do about those chairs. An officer can still seat somebody after that, so a
 * planning screen that inherited the member's answer would hide the shifts most
 * urgently in need of one: the ones starting today.
 */

import type { ShiftRecord } from '../services/api';
import { buildSeats, isShiftOpen, shiftStatusInfo, type ShiftSeat } from './shiftBoard';

export interface StaffingGap {
  shift: ShiftRecord;
  /** Seats the shift says it has. Never null — a shift that never said is not a gap. */
  capacity: number;
  /** People holding a seat on it. */
  filled: number;
  /** `capacity - filled`, always at least 1. */
  openSeats: number;
  /** The empty seats, in the shift's own order, so a name can be put in one. */
  vacancies: ShiftSeat[];
}

/**
 * The shifts in `shifts` that carry fewer people than they ask for.
 *
 * A shift is skipped when it is cancelled, finalized or past — its empty chairs
 * can no longer be filled by anyone — and when it has never stated a crew size.
 * "Crew size not set" is the absence of a staffing level, not one of them: a
 * department that configures neither positions nor a minimum would otherwise
 * open this page on a list of every shift it has ever scheduled.
 *
 * Ordered by how soon the shift starts, then by how many seats are open, so the
 * top of the list is the thing to fix first.
 */
export const staffingGaps = (shifts: ShiftRecord[], today: Date = new Date()): StaffingGap[] =>
  shifts
    .flatMap((shift) => {
      if (!isShiftOpen(shift, today)) return [];
      const info = shiftStatusInfo(shift, null, today);
      if (info.capacity === null) return [];
      const openSeats = info.capacity - info.filled;
      if (openSeats <= 0) return [];
      return [
        {
          shift,
          capacity: info.capacity,
          filled: info.filled,
          openSeats,
          vacancies: buildSeats(shift).filter((seat) => seat.member === null),
        },
      ];
    })
    .sort((a, b) => {
      const byDate = a.shift.shift_date.localeCompare(b.shift.shift_date);
      if (byDate !== 0) return byDate;
      const byStart = (a.shift.start_time ?? '').localeCompare(b.shift.start_time ?? '');
      if (byStart !== 0) return byStart;
      return b.openSeats - a.openSeats;
    });

/** Total seats waiting to be filled across a set of gaps. */
export const totalOpenSeats = (gaps: StaffingGap[]): number =>
  gaps.reduce((running, gap) => running + gap.openSeats, 0);
