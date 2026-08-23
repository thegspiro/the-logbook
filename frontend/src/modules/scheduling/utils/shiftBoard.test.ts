import { describe, it, expect } from 'vitest';
import type { ShiftRecord } from '../services/api';
import {
  DEFAULT_CAPACITY,
  ShiftStatus,
  buildSeats,
  chipLabel,
  dayMatchesFilter,
  daySummary,
  isPastDay,
  memberInitials,
  monthMatrix,
  shiftCapacity,
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

const shift = (overrides: Partial<ShiftRecord> = {}): ShiftRecord => ({
  id: 's1',
  organization_id: 'org',
  shift_date: '2026-08-25',
  start_time: '2026-08-25T22:00:00Z',
  end_time: '2026-08-26T10:00:00Z',
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

  it('falls back to the default when the shift names neither', () => {
    expect(shiftCapacity(shift({ positions: null, min_staffing: null }))).toBe(DEFAULT_CAPACITY);
  });

  it('never reports fewer seats than there are people on the shift', () => {
    const overfull = shift({
      positions: null,
      min_staffing: null,
      roster: Array.from({ length: 6 }, (_, i) => seat(`u${i}`, 'firefighter')),
    });
    expect(shiftCapacity(overfull)).toBe(6);
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
    expect(daySummary([], ME)).toEqual({ openSeats: 0, urgent: false, hasMine: false, shiftCount: 0 });
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
