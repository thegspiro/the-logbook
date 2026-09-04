/**
 * Pure helpers behind the scheduling board.
 *
 * The board's whole job is to make "which shifts still need people" readable
 * at a glance, so every one of those judgements — how many seats a shift has,
 * how many are open, which of the four colours a cell earns — is decided here
 * rather than inside JSX. That keeps the rules testable and, more importantly,
 * keeps the calendar cell, the day panel and the phone sheet from drifting
 * into three slightly different answers about the same shift.
 */

import { formatDateCustom } from '../../../utils/dateFormatting';
import type { PositionSlot, ShiftRecord, ShiftRosterSeat } from '../services/api';

/**
 * The states a shift can be in, in precedence order.
 *
 * `mine` deliberately wins over the staffing colours: a member scanning the
 * month is first asking "where am I already committed", and a blue cell that
 * also happens to be short is still one they cannot claim again.
 *
 * `unknown` is not a staffing level — it is the absence of one. A shift that
 * names neither positions nor a minimum has never said how many people it
 * takes, and guessing a number turns "we don't know" into "this is an
 * emergency": a department that sets neither would open the page to a wall of
 * red that means nothing. It reads as unset, and stays out of every count.
 *
 * `closed` is a shift nobody can sign up for any more — cancelled, finalized,
 * or already run. Its empty chairs are not a shortage: nothing can be done
 * about them, and counting a cancelled shift's four empty seats towards the
 * day's total is how a quiet Tuesday reads as URGENT.
 */
export const ShiftStatus = {
  MINE: 'mine',
  CRITICAL: 'critical',
  SHORT: 'short',
  FULL: 'full',
  UNKNOWN: 'unknown',
  CLOSED: 'closed',
} as const;
export type ShiftStatus = (typeof ShiftStatus)[keyof typeof ShiftStatus];

/** A day carrying this many open seats or more is flagged URGENT. */
export const URGENT_OPEN_SEATS = 3;

export interface ShiftSeat {
  /** Seat label — "officer", "driver", … — or null for an unnamed seat. */
  position: string | null;
  /** The member holding it, or null when the seat is open. */
  member: ShiftRosterSeat | null;
  /** True when the current member holds this seat. */
  isMine: boolean;
}

export interface ShiftStatusInfo {
  status: ShiftStatus;
  /** null when the shift has never stated how many people it takes. */
  capacity: number | null;
  filled: number;
  /**
   * Always 0 when capacity is unknown — an unknown is not a shortage — and
   * always 0 on a closed shift, whose empty seats can no longer be filled.
   */
  openSeats: number;
  /** True when the current member holds a seat, whatever the staffing. */
  isMine: boolean;
  /** False once the shift is cancelled, finalized, or in the past. */
  isOpen: boolean;
  /** True only when the shift was cancelled, as opposed to merely closed. */
  isCancelled: boolean;
}

const activeSeats = (shift: ShiftRecord): ShiftRosterSeat[] =>
  (shift.roster ?? []).filter((seat) => seat.status !== 'cancelled' && seat.status !== 'declined');

/**
 * How many seats the shift has, or null if it has never said.
 *
 * Seat *names* come from the shift's own position list where it has one, so a
 * three-seat brush truck is not reported as short against a department-wide
 * default; `min_staffing` is the fallback. There is deliberately no third
 * fallback: inventing a number would let the board announce a shortage the
 * department never declared, on every shift created without a template or an
 * apparatus.
 */
export const shiftCapacity = (shift: ShiftRecord): number | null => {
  const positions = shift.positions ?? shift.apparatus_positions ?? [];
  if (positions.length > 0) return positions.length;
  if (shift.min_staffing && shift.min_staffing > 0) return shift.min_staffing;
  return null;
};

/**
 * Whether a member can still sign up for this shift.
 *
 * The server refuses self-signup on a cancelled, finalized or past shift, so
 * a board that offered one would hand the member a button whose only outcome
 * is an error toast.
 *
 * This is the *lifecycle* half only, at calendar-day granularity. Whether the
 * shift has already started is `memberSignupClosedReason`; the two together
 * are `isShiftClaimable`, which is what a claim button gates on. They are kept
 * apart because several callers want the lifecycle answer alone — "has this
 * day been and gone" is not the same question as "may I still join".
 */
export const isShiftOpen = (shift: ShiftRecord, today: Date = new Date()): boolean => {
  if (shift.status === 'cancelled') return false;
  if (shift.is_finalized) return false;
  return shift.shift_date >= toDateKey(today);
};

/**
 * The department's signup window: how long before a shift starts self-signup
 * closes, and how long past the start an officer may still seat somebody.
 *
 * Both come from `GET /scheduling/settings`, which any member may read
 * precisely so the board can gate its own buttons.
 */
export interface SignupWindow {
  /** Minutes before start_time that member self-signup closes. 0 = at the start. */
  closesMinutesBefore: number;
  /** Minutes after start_time an officer may still seat somebody. */
  graceMinutes: number;
}

/**
 * What the rules assume before the department's settings have loaded.
 *
 * Deliberately the permissive end of the member rule: a board gating on
 * settings it has not fetched yet would disable a button the server would have
 * accepted, and the member cannot tell that apart from being genuinely too
 * late. The server is authoritative either way.
 */
export const DEFAULT_SIGNUP_WINDOW: SignupWindow = { closesMinutesBefore: 0, graceMinutes: 60 };

/**
 * The shift's start as an epoch instant, or null when it cannot be read.
 *
 * `start_time` is normally an ISO UTC datetime, but a bare "HH:MM" still
 * reaches the client from some responses (see ShiftDetailPanel's `hasStarted`).
 * Returning null rather than NaN matters: NaN compares false in *both*
 * directions, so a single unparseable value would silently close signup on
 * every shift in the department.
 */
const startInstant = (shift: ShiftRecord): number | null => {
  if (!shift.start_time || !shift.start_time.includes('T')) return null;
  const parsed = Date.parse(shift.start_time);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * The shift's end as an epoch instant, or null when it cannot be read.
 *
 * Same contract as `startInstant`, and null for the same reason: `end_time` is
 * optional on `ShiftRecord` and a bare "HH:MM" still reaches the client from
 * some responses, and NaN would compare false in both directions.
 */
const endInstant = (shift: ShiftRecord): number | null => {
  if (!shift.end_time || !shift.end_time.includes('T')) return null;
  const parsed = Date.parse(shift.end_time);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Who is looking at the shift, for the signup window.
 *
 * Mirrors the backend's three actors: a scheduling admin is never bounded, an
 * officer is bounded by the department's grace period, and everyone else by
 * the member cutoff. The client can decide the first two from the caller's
 * org-wide permissions; the shift-officer case is the server's to resolve, and
 * arrives on the detail response as `signup_closed_reason`.
 */
export interface SignupViewer {
  /** Holds scheduling.assign, or is this shift's officer. */
  canAssign: boolean;
  /** Holds scheduling.manage — never bounded, this is the records path. */
  canManage: boolean;
}

const MEMBER_VIEWER: SignupViewer = { canAssign: false, canManage: false };

/**
 * Why this viewer can no longer be seated on this shift, or null if they can.
 *
 * Signup used to be refused only once the shift's calendar *day* had passed, so
 * the board offered a claim button on a 06:00 shift at 23:00 that night. The
 * bound is the shift's own start — minus whatever lead time the department set
 * for members, plus the grace period for an officer — or the later instant an
 * officer opened with `late_signup_until`.
 *
 * Advisory only: the server enforces the same rule and its refusal is what
 * actually stops a signup. No clock-skew tolerance is added on purpose — a
 * fudge factor would put the two sides deliberately out of agreement.
 */
export const signupClosedReason = (
  shift: ShiftRecord,
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW,
  viewer: SignupViewer = MEMBER_VIEWER,
  now: Date = new Date()
): string | null => {
  if (viewer.canManage) return null;

  const start = startInstant(shift);
  if (start === null) return null;

  const override = shift.late_signup_until ? Date.parse(shift.late_signup_until) : NaN;
  const offsetMinutes = viewer.canAssign ? window.graceMinutes : -window.closesMinutesBefore;
  let deadline = start + offsetMinutes * 60_000;
  if (!Number.isNaN(override) && override > deadline) deadline = override;
  if (now.getTime() <= deadline) return null;

  if (viewer.canAssign) return 'This shift started too long ago to add anyone to.';
  if (!Number.isNaN(override)) return 'Late signup for this shift has closed.';
  if (window.closesMinutesBefore > 0 && now.getTime() < start) {
    return 'Signup for this shift has closed.';
  }
  // "Started" is true of last month's shift too, and reads as though it were
  // under way. Once the end has passed, say what actually happened.
  const end = shift.end_time ? Date.parse(shift.end_time) : NaN;
  if (!Number.isNaN(end) && end < now.getTime()) return 'This shift has already run.';
  return 'This shift has already started.';
};

/** The member case of `signupClosedReason` — what a claim button gates on. */
export const memberSignupClosedReason = (
  shift: ShiftRecord,
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW,
  now: Date = new Date()
): string | null => signupClosedReason(shift, window, MEMBER_VIEWER, now);

/**
 * `isShiftOpen` and the member signup window together — what a claim button
 * gates on.
 *
 * Kept separate from `isShiftOpen`, which stays the *lifecycle* predicate
 * (cancelled / finalized / day past) that five other call sites read for other
 * reasons.
 */
export const isShiftClaimable = (
  shift: ShiftRecord,
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW,
  now: Date = new Date()
): boolean => {
  if (shift.status === 'cancelled' || shift.is_finalized) return false;
  if (memberSignupClosedReason(shift, window, now) !== null) return false;
  // `isShiftOpen`'s day comparison is a *fallback*, applied only when the
  // start instant cannot be read. A 18:00–06:00 shift's `shift_date` rolls to
  // yesterday at midnight, so applying it after the precise window had already
  // approved the claim left an officer's 00:30 reopening — exactly when a crew
  // is short — showing a live window with every button disabled.
  return startInstant(shift) !== null || isShiftOpen(shift, now);
};

/**
 * Whether this shift's roster has stopped being a plan and become a record.
 *
 * Signup closing and the roster locking are two different moments, and
 * conflating them was the bug: `signupClosedReason` bounds an officer at the
 * shift's *start* plus the grace period, which is the right bound for "may I
 * still seat somebody", but every roster control — confirm, decline, remove,
 * and the reopen banner itself — went on being offered indefinitely after
 * that. A shift three weeks gone was still showing "Reopen for 15 min" under
 * copy that reads "if you are a body short and somebody can still get here",
 * and a member who had already worked it and had twelve hours recorded was
 * still being offered a button to decline the assignment those hours hang off.
 *
 * The bound is the shift's own *end* plus the same grace period the department
 * already sets for late signup, so an overnight crew keeps its controls
 * through the night and past the hand-over — the day-granular `isShiftOpen`
 * cannot be used here for exactly the reason it is only a fallback elsewhere.
 * A live `late_signup_until` holds the roster open too: an officer who has
 * legitimately reopened the shift needs to seat whoever answers. The server
 * now clamps that override to the same deadline, so it can only ever move the
 * answer for a row written before it did.
 *
 * A scheduling admin is never locked out. That is the same three-actor split
 * the whole signup window uses — the admin path is records work, which happens
 * after the fact by definition, and it is where a genuine correction to a past
 * roster belongs.
 *
 * Advisory, like `signupClosedReason`: the server refuses a reopen past this
 * bound itself, and remains authoritative.
 */
export const rosterLocked = (
  shift: ShiftRecord,
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW,
  viewer: SignupViewer = MEMBER_VIEWER,
  now: Date = new Date()
): boolean => {
  if (viewer.canManage) return false;

  // No end, no lock. `end_time` is optional on `ShiftRecord` for a reason —
  // an open-ended shift is a real shift, not a malformed one — and standing in
  // the start would lock its roster one grace period after it began, with the
  // crew still working. A false lock on a live shift is worse than a missed
  // one on a shift nothing can bound, which is also the permissive stance the
  // rest of this file takes on data it cannot judge.
  const end = endInstant(shift);
  if (end === null) return false;

  let deadline = end + window.graceMinutes * 60_000;
  const override = shift.late_signup_until ? Date.parse(shift.late_signup_until) : NaN;
  if (!Number.isNaN(override) && override > deadline) deadline = override;
  return now.getTime() > deadline;
};

/**
 * The seat list, named seats first and in order, open seats last.
 *
 * Occupants are matched to the seat carrying their position so the roster
 * reads the way the crew is actually organised (officer, driver, then
 * firefighters). Anyone whose position is not on the list still appears —
 * they are on the shift, and hiding them would make the roster lie.
 */
export const buildSeats = (shift: ShiftRecord, currentUserId?: string | null): ShiftSeat[] => {
  const positions: PositionSlot[] = shift.positions ?? shift.apparatus_positions ?? [];
  const unseated = [...activeSeats(shift)];
  const seats: ShiftSeat[] = [];

  // Only a member holding *that* position fills a named seat. Dropping the
  // nearest spare body into an unfilled officer seat would report the shift as
  // staffed when the seat that matters is the empty one.
  const take = (position: string | null): ShiftRosterSeat | null => {
    if (!position) return null;
    const index = unseated.findIndex((seat) => (seat.position ?? '').toLowerCase() === position.toLowerCase());
    if (index === -1) return null;
    return unseated.splice(index, 1)[0] ?? null;
  };

  for (const slot of positions) {
    const member = take(slot.position);
    seats.push({
      position: slot.position,
      member,
      isMine: !!member && !!currentUserId && String(member.user_id) === String(currentUserId),
    });
  }

  // Members holding no named seat, then the unnamed open seats that make the
  // list up to capacity.
  for (const member of unseated) {
    seats.push({
      position: member.position ?? null,
      member,
      isMine: !!currentUserId && String(member.user_id) === String(currentUserId),
    });
  }
  // Pad out to the stated crew size. A shift that states none gets no padding
  // — the list is exactly who is on it, with no invented empty chairs.
  const capacity = shiftCapacity(shift);
  if (capacity !== null) {
    while (seats.length < capacity) {
      seats.push({ position: null, member: null, isMine: false });
    }
  }
  return seats;
};

export const shiftStatusInfo = (
  shift: ShiftRecord,
  currentUserId?: string | null,
  today: Date = new Date(),
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW
): ShiftStatusInfo => {
  const capacity = shiftCapacity(shift);
  const seated = activeSeats(shift);
  // attendee_count is the server's own tally and is present even on responses
  // served before the roster field existed, so it is the more reliable count
  // whenever the two disagree.
  const filled = Math.max(seated.length, shift.attendee_count ?? 0);
  // A shift that started twenty minutes ago has the same empty chairs a
  // cancelled one does: nothing anybody browsing the board can do about them,
  // so they are not a shortage and must not colour the day red.
  const isOpen = isShiftClaimable(shift, window, today);
  const isCancelled = shift.status === 'cancelled';
  const openSeats = capacity === null || !isOpen ? 0 : Math.max(capacity - filled, 0);
  const isMine = !!currentUserId && seated.some((seat) => String(seat.user_id) === String(currentUserId));

  let status: ShiftStatus;
  // `mine` still wins on a closed shift: a member scanning the month for what
  // they worked last week is asking the same question as one scanning for what
  // they are committed to next week.
  if (isMine) status = ShiftStatus.MINE;
  else if (!isOpen) status = ShiftStatus.CLOSED;
  else if (capacity === null) status = ShiftStatus.UNKNOWN;
  else if (openSeats >= 2) status = ShiftStatus.CRITICAL;
  else if (openSeats === 1) status = ShiftStatus.SHORT;
  else status = ShiftStatus.FULL;

  return { status, capacity, filled, openSeats, isMine, isOpen, isCancelled };
};

/** "2 open" / "Full 4/4" / "You + 2/4" / "3 on" — the calendar chip's text. */
export const chipLabel = (info: ShiftStatusInfo): string => {
  // A cancelled shift's headcount is beside the point — what the member needs
  // to know is that it is not happening.
  if (info.isCancelled) return 'Cancelled';
  // With no stated crew size there is no denominator to show, so the chip
  // reports the headcount it does know rather than a ratio it does not.
  if (info.capacity === null || !info.isOpen) {
    return info.isMine ? `You + ${Math.max(info.filled - 1, 0)}` : `${info.filled} on`;
  }
  if (info.isMine) return `You + ${Math.max(info.filled - 1, 0)}/${info.capacity}`;
  if (info.openSeats === 0) return `Full ${info.filled}/${info.capacity}`;
  return `${info.openSeats} open`;
};

/** "2 of 4 seats open" / "Fully staffed" / "You're on it" — the panel badge. */
export const statusBadgeLabel = (info: ShiftStatusInfo): string => {
  if (info.isCancelled) return 'Cancelled';
  if (info.isMine) return "You're on it";
  if (!info.isOpen) return 'Closed to signups';
  if (info.capacity === null) {
    return `${info.filled} on the crew · size not set`;
  }
  if (info.openSeats === 0) return 'Fully staffed';
  return `${info.openSeats} of ${info.capacity} seat${info.openSeats === 1 ? '' : 's'} open`;
};

export interface DaySummary {
  /** Counts only shifts that stated a crew size. */
  openSeats: number;
  /** 3+ open seats across the day's shifts — the day needs a crew, not a seat. */
  urgent: boolean;
  hasMine: boolean;
  shiftCount: number;
  /** True when a shift on this day has never stated how big its crew is. */
  hasUnsizedShift: boolean;
}

export const daySummary = (
  shifts: ShiftRecord[],
  currentUserId?: string | null,
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW
): DaySummary => {
  let openSeats = 0;
  let hasMine = false;
  let hasUnsizedShift = false;
  for (const shift of shifts) {
    const info = shiftStatusInfo(shift, currentUserId, new Date(), window);
    openSeats += info.openSeats;
    if (info.isMine) hasMine = true;
    // Only an *open* shift's missing crew size is worth explaining in the
    // legend; a cancelled one's is not a gap anybody needs to close.
    if (info.capacity === null && info.isOpen) hasUnsizedShift = true;
  }
  return {
    openSeats,
    urgent: openSeats >= URGENT_OPEN_SEATS,
    hasMine,
    shiftCount: shifts.length,
    hasUnsizedShift,
  };
};

/**
 * `D` or `N`, decided in the viewer's timezone.
 *
 * Start times are stored as UTC, so reading the hour off the raw value would
 * relabel a department's night shift as a day shift for anyone east of it —
 * and would flip twice a year as daylight saving moved it across midnight.
 */
export const shiftPeriodLetter = (shift: ShiftRecord, timezone?: string): 'D' | 'N' => {
  const hour = shiftStartHour(shift, timezone);
  return hour === null || hour < 12 ? 'D' : 'N';
};

export const shiftStartHour = (shift: ShiftRecord, timezone?: string): number | null => {
  if (!shift.start_time) return null;
  const formatted = formatDateCustom(shift.start_time, { hour: '2-digit', hour12: false }, timezone);
  const hour = Number.parseInt(formatted, 10);
  // "24" is how some locales spell midnight; treat it as hour zero.
  return Number.isNaN(hour) ? null : hour % 24;
};

/** "Day Duty Crew" / "Night Duty Crew" — the block heading in the day panel. */
export const shiftCrewName = (shift: ShiftRecord, timezone?: string): string =>
  shiftPeriodLetter(shift, timezone) === 'D' ? 'Day Duty Crew' : 'Night Duty Crew';

/** Initials for a seat avatar: "Tam Nguyen" → "TN". */
export const memberInitials = (name?: string | null): string => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '?';
};

/**
 * The six-week grid a month calendar draws, always starting on a Sunday.
 *
 * Fixed at 42 cells rather than "however many rows this month needs" so the
 * grid does not change height as the member pages through the year, which
 * moves every cell under the cursor mid-click.
 */
export const monthMatrix = (year: number, month: number): Date[] => {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });
};

/**
 * Split a flat run of days into calendar weeks.
 *
 * A `role="grid"` needs rows between it and its cells; this is what supplies
 * them without disturbing the CSS grid the cells lay themselves out in.
 */
export const weeksOf = (days: Date[]): Date[][] =>
  Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7));

/** The seven days of the week containing `date`, Sunday first. */
export const weekDates = (date: Date): Date[] => {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });
};

/** Local "YYYY-MM-DD" for a Date, matching the backend's `shift_date`. */
export const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isSameDay = (a: Date, b: Date): boolean => toDateKey(a) === toDateKey(b);

/**
 * Whether a calendar day is behind us.
 *
 * Compared by calendar day, not by instant: a shift starting at 18:00 today is
 * not "past" at 09:00, and dimming it would hide the very shift most likely to
 * still need a body.
 */
export const isPastDay = (date: Date, today: Date = new Date()): boolean => toDateKey(date) < toDateKey(today);

/**
 * Whether a member cleared for `eligible` can take a seat named `position`.
 * An unnamed seat is open to anyone with any clearance at all.
 */
export const canTakeSeat = (position: string | null, eligible: string[]): boolean =>
  eligible.length > 0 && (position === null || eligible.includes(position.toLowerCase()));

/**
 * The seat the primary button claims: the first open one the member is
 * cleared for. Without it the main action would have to ask which seat first,
 * which is the extra tap the whole screen exists to remove.
 */
export const firstClaimableSeat = (
  shift: ShiftRecord,
  eligiblePositions: string[],
  currentUserId?: string | null,
  today: Date = new Date(),
  window: SignupWindow = DEFAULT_SIGNUP_WINDOW
): ShiftSeat | null => {
  // Nothing is claimable on a shift the server will not seat anyone on.
  if (!isShiftClaimable(shift, window, today)) return null;

  const open = buildSeats(shift, currentUserId).find(
    (seat) => seat.member === null && canTakeSeat(seat.position, eligiblePositions)
  );
  if (open) return open;

  // A shift that never stated a crew size has no empty chairs to offer, but it
  // is still a shift a member can join — refusing here would make "nobody has
  // configured this yet" mean "you may not sign up", which is not the
  // department's decision, just a gap in their setup.
  if (shiftCapacity(shift) === null && eligiblePositions.length > 0) {
    return { position: null, member: null, isMine: false };
  }
  return null;
};

export type BoardFilter = 'all' | 'needs' | 'mine';

/**
 * Whether a day passes the active filter.
 *
 * Filters dim rather than hide, so this only decides opacity — the month keeps
 * its shape, and a member counting Tuesdays does not have to re-find them
 * after switching filters.
 */
export const dayMatchesFilter = (summary: DaySummary, filter: BoardFilter): boolean => {
  // "Needs staffing" keeps a day whose crew size was never set: it may well
  // need people, and dimming it would hide the shifts nobody has configured
  // from the one filter an officer uses to find gaps.
  if (filter === 'needs') return summary.openSeats > 0 || summary.hasUnsizedShift;
  if (filter === 'mine') return summary.hasMine;
  return true;
};
