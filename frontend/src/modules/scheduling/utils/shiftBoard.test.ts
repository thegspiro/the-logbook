import { describe, it, expect } from 'vitest';
import type { ShiftRecord } from '../services/api';
import {
  ShiftStatus,
  buildSeats,
  chipLabel,
  dayMatchesFilter,
  daySummary,
  firstClaimableSeat,
  isPastDay,
  isShiftOpen,
  memberInitials,
  monthMatrix,
  shiftCapacity,
  DEFAULT_SIGNUP_WINDOW,
  isShiftClaimable,
  memberSignupClosedReason,
  rosterLocked,
  signupClosedReason,
  shiftCrewName,
  shiftPeriodLetter,
  shiftStatusInfo,
  statusBadgeLabel,
  toDateKey,
  weekDates,
} from './shiftBoard';

const ME = 'me-1';

const seat = (userId: string, position: string, name = 'A Member') => ({
  assignment_id: `a-${userId}`,
  user_id: userId,
  user_name: name,
  position,
  status: 'assigned',
});

// `isShiftOpen` and `firstClaimableSeat` default their `today` argument to a
// real `new Date()`, and a shift is closed to signups the day after it runs.
// A hardcoded fixture date is therefore a time bomb: '2026-08-25' was today
// when this file was written, and the next morning every default-fixture
// shift read as "already run" — 27 tests across this file and
// ShiftSeatList's went red on a commit that touched neither. Anchor the
// fixture to today so it stays an open shift for good. Tests that pin an
// explicit `today` (see TODAY below) keep their literal dates on purpose.
const TODAY_KEY = toDateKey(new Date());

// The default fixture's start must be an *instant* in the future, not a fixed
// wall-clock time: `memberSignupClosedReason` compares it against `Date.now()`,
// so a literal `T22:00:00Z` would close every default-fixture shift after 22:00
// UTC and take this file and ShiftSeatList's red on a commit that touched
// neither — the same time-bomb class the comment above describes, one level
// down. Tests that care about the *hour* (day/night classification) override
// `start_time` with a literal on purpose.
const FUTURE_START = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
const FUTURE_END = new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString();

const shift = (overrides: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: 's1',
  organization_id: 'org',
  shift_date: TODAY_KEY,
  start_time: FUTURE_START,
  end_time: FUTURE_END,
  positions: [
    { position: 'officer', required: true },
    { position: 'driver', required: true },
    { position: 'firefighter', required: true },
    { position: 'firefighter', required: true },
  ],
  attendee_count: 0,
  call_count: 0,
  is_finalized: false,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  roster: [],
  ...overrides,
});

describe('shiftCapacity', () => {
  it('counts the shift’s own seats', () => {
    expect(shiftCapacity(shift())).toBe(4);
  });

  it('falls back to min_staffing when no positions are defined', () => {
    expect(shiftCapacity(shift({ positions: null, min_staffing: 3 }))).toBe(3);
  });

  it('does not report a three-seat unit as short against a department default', () => {
    const brush = shift({ positions: [{ position: 'firefighter', required: true }] });
    expect(shiftCapacity(brush)).toBe(1);
  });

  it('reports no size at all when the shift names neither', () => {
    // Inventing a number here is how a department that configures neither
    // opens the page to a wall of red that means nothing.
    expect(shiftCapacity(shift({ positions: null, min_staffing: null }))).toBeNull();
  });

  it('still reports no size when people are already on an unsized shift', () => {
    const crewed = shift({
      positions: null,
      min_staffing: null,
      roster: Array.from({ length: 6 }, (_, i) => seat(`u${i}`, 'firefighter')),
    });
    // Six people turning up is not the department stating the crew is six.
    expect(shiftCapacity(crewed)).toBeNull();
  });
});

describe('shiftStatusInfo', () => {
  it('is critical with two or more seats open', () => {
    const info = shiftStatusInfo(shift({ roster: [seat('u1', 'officer')], attendee_count: 1 }), ME);
    expect(info.status).toBe(ShiftStatus.CRITICAL);
    expect(info.openSeats).toBe(3);
  });

  it('is short with exactly one seat open', () => {
    const roster = [seat('u1', 'officer'), seat('u2', 'driver'), seat('u3', 'firefighter')];
    const info = shiftStatusInfo(shift({ roster, attendee_count: 3 }), ME);
    expect(info.status).toBe(ShiftStatus.SHORT);
    expect(info.openSeats).toBe(1);
  });

  it('is full when every seat is taken', () => {
    const roster = [seat('u1', 'officer'), seat('u2', 'driver'), seat('u3', 'firefighter'), seat('u4', 'firefighter')];
    expect(shiftStatusInfo(shift({ roster, attendee_count: 4 }), ME).status).toBe(ShiftStatus.FULL);
  });

  it('"you are on it" wins over a short crew', () => {
    // A member scanning the month is first asking where they are committed,
    // and a shift they hold is not one they can claim again.
    const info = shiftStatusInfo(shift({ roster: [seat(ME, 'driver')], attendee_count: 1 }), ME);
    expect(info.status).toBe(ShiftStatus.MINE);
    expect(info.openSeats).toBe(3);
  });

  it('trusts the server tally when the roster is missing', () => {
    // Responses served before the roster field existed still carry a count.
    const info = shiftStatusInfo(shift({ roster: undefined, attendee_count: 4 }), ME);
    expect(info.filled).toBe(4);
    expect(info.status).toBe(ShiftStatus.FULL);
  });

  it('ignores cancelled and declined seats', () => {
    const roster = [
      seat('u1', 'officer'),
      { ...seat('u2', 'driver'), status: 'cancelled' },
      { ...seat('u3', 'firefighter'), status: 'declined' },
    ];
    expect(shiftStatusInfo(shift({ roster, attendee_count: 1 }), ME).filled).toBe(1);
  });

  it('never reports negative open seats when a shift is over-crewed', () => {
    const roster = Array.from({ length: 6 }, (_, i) => seat(`u${i}`, 'firefighter'));
    expect(shiftStatusInfo(shift({ roster, attendee_count: 6 }), ME).openSeats).toBe(0);
  });

  it('is not "mine" for an anonymous viewer', () => {
    expect(shiftStatusInfo(shift({ roster: [seat(ME, 'driver')] }), null).isMine).toBe(false);
  });
});

describe('buildSeats', () => {
  it('lays the crew out in the shift’s own seat order', () => {
    const roster = [seat('u3', 'firefighter', 'Casey Lee'), seat('u1', 'officer', 'Dana Ruiz')];
    const seats = buildSeats(shift({ roster }), ME);
    expect(seats.map((s) => s.position)).toEqual(['officer', 'driver', 'firefighter', 'firefighter']);
    expect(seats[0]?.member?.user_name).toBe('Dana Ruiz');
    expect(seats[1]?.member).toBeNull();
    expect(seats[2]?.member?.user_name).toBe('Casey Lee');
  });

  it('leaves a named seat open rather than filling it with a spare body', () => {
    // Seating the nearest firefighter in the officer's chair would report the
    // shift as staffed when the empty seat is the one that matters.
    const seats = buildSeats(shift({ roster: [seat('u1', 'firefighter')] }), ME);
    expect(seats[0]?.position).toBe('officer');
    expect(seats[0]?.member).toBeNull();
  });

  it('still shows a member whose position is not on the seat list', () => {
    const seats = buildSeats(shift({ roster: [seat('u9', 'ems', 'Sam Poe')] }), ME);
    expect(seats.some((s) => s.member?.user_name === 'Sam Poe')).toBe(true);
  });

  it('marks the current member’s own seat', () => {
    const seats = buildSeats(shift({ roster: [seat(ME, 'driver')] }), ME);
    expect(seats.find((s) => s.isMine)?.position).toBe('driver');
  });

  it('pads to capacity when the shift names no positions', () => {
    const seats = buildSeats(shift({ positions: null, min_staffing: 3, roster: [seat('u1', 'firefighter')] }), ME);
    expect(seats).toHaveLength(3);
    expect(seats.filter((s) => s.member === null)).toHaveLength(2);
  });

  it('gives each duplicate seat its own occupant', () => {
    const roster = [seat('u3', 'firefighter', 'One'), seat('u4', 'firefighter', 'Two')];
    const seats = buildSeats(shift({ roster }), ME);
    expect(seats[2]?.member?.user_name).toBe('One');
    expect(seats[3]?.member?.user_name).toBe('Two');
  });
});

describe('labels', () => {
  it('reads "N open" when seats are free', () => {
    expect(chipLabel(shiftStatusInfo(shift({ attendee_count: 2 }), ME))).toBe('2 open');
  });

  it('reads "Full n/n" when staffed', () => {
    expect(chipLabel(shiftStatusInfo(shift({ attendee_count: 4 }), ME))).toBe('Full 4/4');
  });

  it('counts the rest of the crew alongside you', () => {
    const roster = [seat(ME, 'driver'), seat('u2', 'officer')];
    expect(chipLabel(shiftStatusInfo(shift({ roster, attendee_count: 2 }), ME))).toBe('You + 1/4');
  });

  it('spells the badge with the seat count', () => {
    expect(statusBadgeLabel(shiftStatusInfo(shift({ attendee_count: 2 }), ME))).toBe('2 of 4 seats open');
    expect(statusBadgeLabel(shiftStatusInfo(shift({ attendee_count: 3 }), ME))).toBe('1 of 4 seat open');
    expect(statusBadgeLabel(shiftStatusInfo(shift({ attendee_count: 4 }), ME))).toBe('Fully staffed');
    expect(statusBadgeLabel(shiftStatusInfo(shift({ roster: [seat(ME, 'driver')] }), ME))).toBe("You're on it");
  });
});

describe('daySummary', () => {
  it('adds the open seats across the day', () => {
    const summary = daySummary([shift({ attendee_count: 3 }), shift({ id: 's2', attendee_count: 3 })], ME);
    expect(summary.openSeats).toBe(2);
    expect(summary.urgent).toBe(false);
  });

  it('flags a day three or more seats short', () => {
    const summary = daySummary([shift({ attendee_count: 2 }), shift({ id: 's2', attendee_count: 3 })], ME);
    expect(summary.openSeats).toBe(3);
    expect(summary.urgent).toBe(true);
  });

  it('reports a day you are on', () => {
    expect(daySummary([shift({ roster: [seat(ME, 'driver')] })], ME).hasMine).toBe(true);
  });

  it('is empty for a day with no shifts', () => {
    expect(daySummary([], ME)).toEqual({
      openSeats: 0,
      urgent: false,
      hasMine: false,
      shiftCount: 0,
      hasUnsizedShift: false,
    });
  });

  it('does not count an unsized shift as a shortage', () => {
    const unsized = shift({ positions: null, min_staffing: null, attendee_count: 1 });
    const summary = daySummary([unsized], ME);
    expect(summary.openSeats).toBe(0);
    expect(summary.urgent).toBe(false);
    expect(summary.hasUnsizedShift).toBe(true);
  });

  it('an unsized shift does not drown out a real shortage beside it', () => {
    const unsized = shift({ id: 's2', positions: null, min_staffing: null });
    const short = shift({ attendee_count: 2 });
    expect(daySummary([unsized, short], ME).openSeats).toBe(2);
  });
});

describe('dayMatchesFilter', () => {
  const staffed = daySummary([shift({ attendee_count: 4 })], ME);
  const short = daySummary([shift({ attendee_count: 2 })], ME);
  const mine = daySummary([shift({ roster: [seat(ME, 'driver')], attendee_count: 4 })], ME);

  it('shows everything under "all"', () => {
    expect(dayMatchesFilter(staffed, 'all')).toBe(true);
    expect(dayMatchesFilter(short, 'all')).toBe(true);
  });

  it('"needs staffing" keeps only days with open seats', () => {
    expect(dayMatchesFilter(short, 'needs')).toBe(true);
    expect(dayMatchesFilter(staffed, 'needs')).toBe(false);
  });

  it('"my shifts" keeps only days you are on', () => {
    expect(dayMatchesFilter(mine, 'mine')).toBe(true);
    expect(dayMatchesFilter(short, 'mine')).toBe(false);
  });
});

describe('shiftPeriodLetter', () => {
  it('reads the start hour in the given timezone, not off the raw UTC value', () => {
    // 22:00 UTC is 18:00 in New York — a night shift there, and relabelling it
    // "D" for anyone east of the department is exactly the bug this avoids.
    const night = shift({ start_time: '2026-08-25T22:00:00Z' });
    expect(shiftPeriodLetter(night, 'America/New_York')).toBe('N');
    expect(shiftPeriodLetter(night, 'UTC')).toBe('N');
  });

  it('calls a morning start a day shift', () => {
    const day = shift({ start_time: '2026-08-25T10:00:00Z' });
    expect(shiftPeriodLetter(day, 'America/New_York')).toBe('D');
    expect(shiftCrewName(day, 'America/New_York')).toBe('Day Duty Crew');
  });

  it('treats a shift with no start time as a day shift rather than throwing', () => {
    expect(shiftPeriodLetter(shift({ start_time: '' }), 'UTC')).toBe('D');
  });

  it('handles the midnight boundary', () => {
    // 04:00 UTC is 00:00 in New York; midnight must not read as hour 24.
    const midnight = shift({ start_time: '2026-08-26T04:00:00Z' });
    expect(shiftPeriodLetter(midnight, 'America/New_York')).toBe('D');
  });
});

describe('memberInitials', () => {
  it('takes the first and last initial', () => {
    expect(memberInitials('Tam Nguyen')).toBe('TN');
  });

  it('handles a middle name', () => {
    expect(memberInitials('Ada B Lovelace')).toBe('AL');
  });

  it('handles a single name', () => {
    expect(memberInitials('Cher')).toBe('C');
  });

  it('degrades rather than rendering an empty circle', () => {
    expect(memberInitials('')).toBe('?');
    expect(memberInitials(null)).toBe('?');
    expect(memberInitials('   ')).toBe('?');
  });
});

describe('monthMatrix', () => {
  it('always renders six weeks so the grid does not change height', () => {
    expect(monthMatrix(2026, 7)).toHaveLength(42);
    expect(monthMatrix(2026, 1)).toHaveLength(42);
  });

  it('starts on the Sunday on or before the first of the month', () => {
    // August 2026 opens on a Saturday, so the grid starts Sunday July 26.
    const cells = monthMatrix(2026, 7);
    expect(cells[0]?.getDay()).toBe(0);
    expect(toDateKey(cells[0] as Date)).toBe('2026-07-26');
  });

  it('contains every day of the month', () => {
    const keys = monthMatrix(2026, 7).map(toDateKey);
    expect(keys).toContain('2026-08-01');
    expect(keys).toContain('2026-08-31');
  });
});

describe('weekDates', () => {
  it('returns Sunday through Saturday around the given day', () => {
    const week = weekDates(new Date(2026, 7, 25));
    expect(week).toHaveLength(7);
    expect(toDateKey(week[0] as Date)).toBe('2026-08-23');
    expect(toDateKey(week[6] as Date)).toBe('2026-08-29');
  });
});

describe('isPastDay', () => {
  it('compares whole days, not instants', () => {
    // A shift starting at 18:00 today is not past at 09:00, and dimming it
    // would hide the shift most likely to still need a body.
    const today = new Date(2026, 7, 25, 9, 0);
    expect(isPastDay(new Date(2026, 7, 25, 18, 0), today)).toBe(false);
    expect(isPastDay(new Date(2026, 7, 24), today)).toBe(true);
    expect(isPastDay(new Date(2026, 7, 26), today)).toBe(false);
  });
});

describe('a shift that never stated its crew size', () => {
  const unsized = (overrides: Partial<ShiftRecord> = {}) =>
    shift({ positions: null, min_staffing: null, ...overrides });

  it('reads as unset, not as an emergency', () => {
    const info = shiftStatusInfo(unsized({ attendee_count: 1 }), ME);
    expect(info.status).toBe(ShiftStatus.UNKNOWN);
    expect(info.capacity).toBeNull();
    expect(info.openSeats).toBe(0);
  });

  it('still shows as yours when you are on it', () => {
    // Whether the department configured the shift has nothing to do with
    // whether the member is committed to it.
    const info = shiftStatusInfo(unsized({ roster: [seat(ME, 'firefighter')] }), ME);
    expect(info.status).toBe(ShiftStatus.MINE);
  });

  it('reports the headcount rather than a ratio it cannot compute', () => {
    expect(chipLabel(shiftStatusInfo(unsized({ attendee_count: 3 }), ME))).toBe('3 on');
    expect(statusBadgeLabel(shiftStatusInfo(unsized({ attendee_count: 3 }), ME))).toBe('3 on the crew · size not set');
  });

  it('lists exactly who is on it, with no invented empty chairs', () => {
    const seats = buildSeats(unsized({ roster: [seat('u1', 'firefighter')] }), ME);
    expect(seats).toHaveLength(1);
    expect(seats.every((s) => s.member !== null)).toBe(true);
  });

  it('can still be joined by an eligible member', () => {
    // "Nobody has configured this yet" is not the department refusing signup.
    const claimable = firstClaimableSeat(unsized(), ['firefighter'], ME);
    expect(claimable).not.toBeNull();
    expect(claimable?.position).toBeNull();
  });

  it('is not offered to a member cleared for nothing', () => {
    expect(firstClaimableSeat(unsized(), [], ME)).toBeNull();
  });

  it('is kept by the "needs staffing" filter', () => {
    // It may well need people; dimming it would hide the unconfigured shifts
    // from the one filter an officer uses to find gaps.
    expect(dayMatchesFilter(daySummary([unsized()], ME), 'needs')).toBe(true);
  });
});

describe('a shift nobody can sign up for any more', () => {
  // The server refuses self-signup on a cancelled, finalized or past shift.
  // A board that counted their empty chairs would report a shortage nobody
  // can act on, and would offer a button whose only outcome is an error.
  const TODAY = new Date('2026-08-25T12:00:00Z');
  // A shift that ran yesterday, and whose start says so too. The two have to
  // agree: `shift_date` and `start_time` describe one shift, and since the
  // claim rules now take the start instant as the authority (so an overnight
  // shift's midnight rollover cannot close a live reopening), a fixture with
  // a past date and a future start is not a shift any department could have.
  const RAN_YESTERDAY = { shift_date: '2026-08-24', start_time: '2026-08-24T18:00:00Z' };

  it('is closed once cancelled', () => {
    expect(isShiftOpen(shift({ status: 'cancelled' }), TODAY)).toBe(false);
  });

  it('is closed once finalized', () => {
    expect(isShiftOpen(shift({ is_finalized: true }), TODAY)).toBe(false);
  });

  it('is closed once the day has passed', () => {
    expect(isShiftOpen(shift(RAN_YESTERDAY), TODAY)).toBe(false);
  });

  it('is still open on its own day', () => {
    expect(isShiftOpen(shift({ shift_date: '2026-08-25' }), TODAY)).toBe(true);
  });

  it('reports no open seats, whatever its crew size says', () => {
    const info = shiftStatusInfo(shift({ status: 'cancelled' }), ME, TODAY);
    expect(info.openSeats).toBe(0);
    expect(info.status).toBe(ShiftStatus.CLOSED);
  });

  it('keeps a day off the urgent list', () => {
    // Four empty seats on a cancelled shift is not three-or-more open seats.
    const summary = daySummary([shift({ status: 'cancelled' })], ME);
    expect(summary.openSeats).toBe(0);
    expect(summary.urgent).toBe(false);
  });

  it('offers no seat to claim', () => {
    expect(firstClaimableSeat(shift({ status: 'cancelled' }), ['firefighter'], ME, TODAY)).toBeNull();
    expect(firstClaimableSeat(shift(RAN_YESTERDAY), ['firefighter'], ME, TODAY)).toBeNull();
  });

  it('still shows a member the shift they were on', () => {
    // Precedence: a member scanning the month for what they worked last week
    // is asking the same question as one scanning for next week.
    const worked = shift({
      ...RAN_YESTERDAY,
      roster: [seat(ME, 'driver')],
      attendee_count: 1,
    });
    expect(shiftStatusInfo(worked, ME, TODAY).status).toBe(ShiftStatus.MINE);
  });

  it('says cancelled on the chip rather than a headcount', () => {
    const info = shiftStatusInfo(shift({ status: 'cancelled' }), null, TODAY);
    expect(chipLabel(info)).toBe('Cancelled');
    expect(statusBadgeLabel(info)).toBe('Cancelled');
  });
});

describe('memberSignupClosedReason', () => {
  const at = (minutesFromNow: number) =>
    shift({ start_time: new Date(Date.now() + minutesFromNow * 60_000).toISOString() });

  it('is open before the shift starts', () => {
    expect(memberSignupClosedReason(at(60))).toBeNull();
  });

  it('closes once the shift has started', () => {
    // The regression this exists for: the old rule compared calendar days, so
    // a shift that began ten hours ago was still "today" and still claimable.
    expect(memberSignupClosedReason(at(-600))).toBe('This shift has already started.');
  });

  it('closes early when the department set a lead time', () => {
    const window = { closesMinutesBefore: 30, graceMinutes: 60 };
    expect(memberSignupClosedReason(at(31), window)).toBeNull();
    expect(memberSignupClosedReason(at(29), window)).toBe('Signup for this shift has closed.');
  });

  it('is reopened by a live late-signup window', () => {
    const reopened = {
      ...at(-600),
      late_signup_until: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    expect(memberSignupClosedReason(reopened)).toBeNull();
  });

  it('names an expired late-signup window rather than the generic reason', () => {
    const expired = {
      ...at(-600),
      late_signup_until: new Date(Date.now() - 5 * 60_000).toISOString(),
    };
    expect(memberSignupClosedReason(expired)).toBe('Late signup for this shift has closed.');
  });

  it('never lets an expired override shorten the natural deadline', () => {
    const future = {
      ...at(60),
      late_signup_until: new Date(Date.now() - 60 * 60_000).toISOString(),
    };
    expect(memberSignupClosedReason(future)).toBeNull();
  });

  it('falls back to the lifecycle rule when the start is not an instant', () => {
    // A bare "HH:MM" still reaches the client from some responses. Returning
    // null beats NaN, which compares false in both directions and would close
    // every shift in the department.
    expect(memberSignupClosedReason(shift({ start_time: '07:00' }))).toBeNull();
    expect(memberSignupClosedReason(shift({ start_time: '' }))).toBeNull();
  });

  it('does not close a future shift under the pre-settings default', () => {
    expect(memberSignupClosedReason(at(1), DEFAULT_SIGNUP_WINDOW)).toBeNull();
  });
});

describe('isShiftClaimable', () => {
  const started = shift({ start_time: new Date(Date.now() - 60 * 60_000).toISOString() });

  it('is false on a shift that has started', () => {
    expect(isShiftClaimable(started)).toBe(false);
  });

  it('is false on a cancelled shift even inside a late-signup window', () => {
    const cancelled = {
      ...started,
      status: 'cancelled' as const,
      late_signup_until: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    expect(isShiftClaimable(cancelled)).toBe(false);
  });
});

describe('shiftStatusInfo after the start', () => {
  it('stops counting the empty chairs of a shift that has gone out', () => {
    // A started shift's open seats are not a shortage anybody browsing the
    // board can fix, which is the same argument a cancelled shift's are not.
    const started = shift({ start_time: new Date(Date.now() - 60 * 60_000).toISOString() });
    const info = shiftStatusInfo(started);
    expect(info.isOpen).toBe(false);
    expect(info.openSeats).toBe(0);
  });
});

describe('signupClosedReason by actor', () => {
  const at = (minutesFromNow: number) =>
    shift({ start_time: new Date(Date.now() + minutesFromNow * 60_000).toISOString() });
  const MEMBER = { canAssign: false, canManage: false };
  const OFFICER = { canAssign: true, canManage: false };
  const ADMIN = { canAssign: false, canManage: true };

  it('bounds an officer by the grace period, not the member cutoff', () => {
    // The whole point of the grace: an officer seats somebody after the crew
    // has gone out. Gating their controls on the member rule would block a
    // path the server accepts.
    const started = at(-30);
    expect(signupClosedReason(started, DEFAULT_SIGNUP_WINDOW, MEMBER)).not.toBeNull();
    expect(signupClosedReason(started, DEFAULT_SIGNUP_WINDOW, OFFICER)).toBeNull();
  });

  it('closes for an officer past the grace period', () => {
    expect(signupClosedReason(at(-90), DEFAULT_SIGNUP_WINDOW, OFFICER)).toBe(
      'This shift started too long ago to add anyone to.'
    );
  });

  it('never bounds a scheduling admin', () => {
    const window = { closesMinutesBefore: 10080, graceMinutes: 0 };
    expect(signupClosedReason(at(-100_000), window, ADMIN)).toBeNull();
  });

  it('does not apply the member lead time to an officer', () => {
    const window = { closesMinutesBefore: 10080, graceMinutes: 60 };
    expect(signupClosedReason(at(60), window, MEMBER)).not.toBeNull();
    expect(signupClosedReason(at(60), window, OFFICER)).toBeNull();
  });

  it('lets a late-signup window reopen the shift for an officer too', () => {
    const reopened = {
      ...at(-600),
      late_signup_until: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    expect(signupClosedReason(reopened, DEFAULT_SIGNUP_WINDOW, OFFICER)).toBeNull();
  });

  it('defaults to the member rule when no viewer is given', () => {
    expect(signupClosedReason(at(-30))).toBe(memberSignupClosedReason(at(-30)));
  });
});

describe('an overnight shift after its date has rolled over', () => {
  // A 18:00–06:00 shift is "yesterday" from midnight. The day-granular rule is
  // only a fallback, or an officer's 00:30 reopening — exactly when a crew is
  // short — shows a live window with every button disabled.
  const overnight = (overrides: Partial<ShiftRecord> = {}) =>
    shift({
      shift_date: toDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      start_time: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      end_time: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      ...overrides,
    });

  it('is claimable again while a reopening is live', () => {
    const reopened = overnight({
      late_signup_until: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    expect(isShiftClaimable(reopened)).toBe(true);
    expect(shiftStatusInfo(reopened).isOpen).toBe(true);
  });

  it('is not claimable without one', () => {
    expect(isShiftClaimable(overnight())).toBe(false);
  });

  it('still falls back to the day rule when the start cannot be read', () => {
    const unreadable = overnight({ start_time: '18:00' });
    expect(isShiftClaimable(unreadable)).toBe(false);
  });
});

describe('rosterLocked', () => {
  const MEMBER = { canAssign: false, canManage: false };
  const OFFICER = { canAssign: true, canManage: false };
  const ADMIN = { canAssign: false, canManage: true };

  // Minutes from now, as an instant pair. `ran` is the shift the bug was
  // reported on: over, days ago, still offering every live control it had.
  const window = (startMinutes: number, endMinutes: number) =>
    shift({
      shift_date: toDateKey(new Date(Date.now() + startMinutes * 60_000)),
      start_time: new Date(Date.now() + startMinutes * 60_000).toISOString(),
      end_time: new Date(Date.now() + endMinutes * 60_000).toISOString(),
    });
  const ran = window(-20 * 24 * 60 - 720, -20 * 24 * 60);

  it('locks a shift that ran weeks ago', () => {
    expect(rosterLocked(ran, DEFAULT_SIGNUP_WINDOW, OFFICER)).toBe(true);
    expect(rosterLocked(ran, DEFAULT_SIGNUP_WINDOW, MEMBER)).toBe(true);
  });

  it('leaves an upcoming shift alone', () => {
    expect(rosterLocked(shift(), DEFAULT_SIGNUP_WINDOW, OFFICER)).toBe(false);
  });

  it('keeps an overnight crew’s controls through the shift', () => {
    // Six hours in, six to go. `isPast` is already true — the date rolled at
    // midnight — which is exactly why this rule cannot be day-granular.
    const overnight = window(-6 * 60, 6 * 60);
    expect(rosterLocked(overnight, DEFAULT_SIGNUP_WINDOW, OFFICER)).toBe(false);
    expect(rosterLocked(overnight, DEFAULT_SIGNUP_WINDOW, MEMBER)).toBe(false);
  });

  it('holds the roster open through the grace period after the end', () => {
    // Signup closed for the officer long ago — the officer bound counts from
    // the *start* — but the crew has only just come in, so the roster is still
    // being settled.
    const justEnded = window(-12 * 60 - 30, -30);
    expect(signupClosedReason(justEnded, DEFAULT_SIGNUP_WINDOW, OFFICER)).not.toBeNull();
    expect(rosterLocked(justEnded, DEFAULT_SIGNUP_WINDOW, OFFICER)).toBe(false);
  });

  it('locks once the grace period past the end has run out', () => {
    const window90 = { closesMinutesBefore: 0, graceMinutes: 60 };
    expect(rosterLocked(window(-12 * 60 - 90, -90), window90, OFFICER)).toBe(true);
    expect(rosterLocked(window(-12 * 60 - 30, -30), window90, OFFICER)).toBe(false);
  });

  it('never locks a scheduling admin out', () => {
    // The records path. Correcting a roster from last month is the whole job.
    expect(rosterLocked(ran, DEFAULT_SIGNUP_WINDOW, ADMIN)).toBe(false);
  });

  it('stays open while a late-signup window an officer opened is live', () => {
    const reopened = { ...ran, late_signup_until: new Date(Date.now() + 15 * 60_000).toISOString() };
    expect(rosterLocked(reopened, DEFAULT_SIGNUP_WINDOW, OFFICER)).toBe(false);
  });

  it('leaves an open-ended shift unlocked however long ago it began', () => {
    // `end_time` is optional on a shift, and an open-ended one is real rather
    // than malformed. Standing the start in for the missing end would lock it
    // one grace period after it began, with the crew still working — a false
    // lock on a live shift, which is worse than no lock on one nothing can
    // bound.
    const openEnded = { ...ran, end_time: undefined };
    expect(rosterLocked(openEnded, DEFAULT_SIGNUP_WINDOW, OFFICER)).toBe(false);
    expect(rosterLocked(openEnded, DEFAULT_SIGNUP_WINDOW, MEMBER)).toBe(false);
  });

  it('leaves an end it cannot read unlocked', () => {
    // A bare "HH:MM" end still reaches the client from some responses. It is
    // the same unjudgeable case, and takes the same permissive answer.
    const unreadable = { ...ran, end_time: '19:00' };
    expect(rosterLocked(unreadable, DEFAULT_SIGNUP_WINDOW, OFFICER)).toBe(false);
  });

  it('defaults to the member view when no viewer is given', () => {
    expect(rosterLocked(ran)).toBe(true);
  });
});
