/**
 * How the close-out queue describes the rows the server gave it.
 *
 * **This does not decide which shifts are waiting; the server does.**
 * `GET /scheduling/shifts/needing-closeout` reads the same predicate the hub's
 * "To close out" metric counts, and re-testing its answer here is how the two
 * came apart in the first place. It is also actively wrong to re-test it: the
 * cushion comes from the department's settings, which this tab caches, so an
 * officer who lowers the cushion elsewhere makes every other open tab drop rows
 * the server had just declared overdue — and the page would say "Every shift is
 * closed out" with a positive total sitting next to it.
 *
 * What is left is presentation: when each shift was over, and for how long it
 * has waited. That still goes through `shiftBoard.ts`'s `shiftEndInstant` —
 * `end_time`, else `start_time` plus the cushion — because the board, the roster
 * lock and this badge must not come to three different answers about one shift.
 * A cached cushion makes that number slightly stale; it does not make a row
 * vanish, which is the difference that matters.
 *
 * Server order is preserved rather than re-sorted, for the same reason: the
 * endpoint orders by the end it computed, and re-sorting by the end this tab
 * computes would interleave rows differently from the list the server paged.
 */

import type { ShiftRecord } from '../services/api';
import { DEFAULT_SIGNUP_WINDOW, shiftEndInstant, type SignupWindow } from './shiftBoard';

export interface CloseoutQueueEntry {
  shift: ShiftRecord;
  /**
   * When the shift was over — its end, or its start plus the cushion.
   *
   * Null when neither can be read. The row still belongs in the queue: the
   * server put it there, and dropping it here would be this file deciding
   * membership again. Only the badge goes unknown.
   */
  endedAt: number | null;
  /** Whole hours since then, or null when `endedAt` is. Never negative. */
  waitingHours: number | null;
  /** True when the shift never stated an end and the cushion decided this. */
  openEnded: boolean;
}

/** An hour, in milliseconds. Ages above a day are reported in days. */
const HOUR_MS = 60 * 60_000;

/**
 * The server's rows, described.
 *
 * One entry per row in, in the order they came in. `now` is read on every
 * clock tick so the badges age while the page is open.
 */
export const closeoutQueue = (
  shifts: ShiftRecord[],
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW,
  now: number = Date.now()
): CloseoutQueueEntry[] =>
  shifts.map((shift) => {
    const endedAt = shiftEndInstant(shift, window);
    return {
      shift,
      endedAt,
      waitingHours: endedAt === null ? null : Math.max(0, Math.floor((now - endedAt) / HOUR_MS)),
      openEnded: !shift.end_time,
    };
  });

/**
 * "3 hours" / "2 days" — how long this row has been waiting, for a badge.
 *
 * Hours below a day, because a shift that ended this morning and one that ended
 * last Tuesday are different problems and "0 days" says neither.
 *
 * An unreadable end says so rather than reading as no wait at all. The row is
 * in the queue either way; what is unknown is how long it has been there.
 */
export const waitingLabel = (entry: CloseoutQueueEntry): string => {
  if (entry.waitingHours === null) return 'an unknown time';
  if (entry.waitingHours < 1) return 'under an hour';
  if (entry.waitingHours < 24) return `${entry.waitingHours} ${entry.waitingHours === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(entry.waitingHours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};
