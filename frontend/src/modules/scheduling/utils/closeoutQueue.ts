/**
 * Which shifts have been and gone without anybody closing them out.
 *
 * Built on `shiftBoard.ts` rather than beside it, for the same reason the
 * staffing-gaps list is: the board, the roster lock and this queue must not
 * come to three different answers about when one shift ended. `shiftEndInstant`
 * is that single answer, and it is also how the server derives the hub's
 * "To close out" metric — `end_time`, else `start_time` plus the department's
 * open-ended cushion.
 *
 * The cushion is the whole reason this is not a one-line filter. A shift with
 * no recorded end is not a malformed shift: a crew goes out and comes back when
 * the job is done. Treating it as ended the instant it began puts a crew still
 * working at the top of the backlog, and nothing clears it until somebody
 * finalizes a shift they are still on.
 */

import type { ShiftRecord } from '../services/api';
import { DEFAULT_SIGNUP_WINDOW, shiftEndInstant, type SignupWindow } from './shiftBoard';

export interface CloseoutQueueEntry {
  shift: ShiftRecord;
  /** When the shift was over — its end, or its start plus the cushion. */
  endedAt: number;
  /** Whole hours since then. Never negative. */
  waitingHours: number;
  /** True when the shift never stated an end and the cushion decided this. */
  openEnded: boolean;
}

/** A day, in milliseconds. Ages above this are reported in days. */
const HOUR_MS = 60 * 60_000;

/**
 * The shifts in `shifts` that have ended and were never finalized.
 *
 * Cancelled shifts are excluded — there is nothing to close out on a shift that
 * did not run, and counting them makes a backlog that can never reach zero. So
 * is a shift whose end cannot be read at all: the queue's whole claim is that
 * each row has waited a knowable length of time, and a row with no answer to
 * that is worse than an absent one.
 *
 * Oldest first: the longer a shift sits unclosed, the more likely its crew has
 * forgotten what happened on it.
 */
export const closeoutQueue = (
  shifts: ShiftRecord[],
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW,
  now: number = Date.now()
): CloseoutQueueEntry[] =>
  shifts
    .flatMap((shift) => {
      if (shift.is_finalized) return [];
      if (shift.status === 'cancelled') return [];
      const endedAt = shiftEndInstant(shift, window);
      if (endedAt === null || endedAt >= now) return [];
      return [
        {
          shift,
          endedAt,
          waitingHours: Math.max(0, Math.floor((now - endedAt) / HOUR_MS)),
          openEnded: !shift.end_time,
        },
      ];
    })
    .sort((a, b) => a.endedAt - b.endedAt);

/**
 * "3 hours" / "2 days" — how long this row has been waiting, for a badge.
 *
 * Hours below a day, because a shift that ended this morning and one that ended
 * last Tuesday are different problems and "0 days" says neither.
 */
export const waitingLabel = (entry: CloseoutQueueEntry): string => {
  if (entry.waitingHours < 1) return 'under an hour';
  if (entry.waitingHours < 24) return `${entry.waitingHours} ${entry.waitingHours === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(entry.waitingHours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};
