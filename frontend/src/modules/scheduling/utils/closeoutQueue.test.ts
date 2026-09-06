/**
 * How the close-out queue describes the rows the server gave it.
 *
 * **Which shifts are waiting is no longer decided here**, and the tests that
 * used to assert it have moved to where the decision lives:
 * `backend/tests/test_scheduling_closeout_backlog.py::TestPopulation` covers
 * the finalized shift, the cancelled one, the one that has not ended, the
 * open-ended one inside its cushion, a department's longer cushion, and another
 * department's shift. The order is `TestOrder` in the same file.
 *
 * What is left here is the badge — when each shift was over, and for how long
 * it has waited — and the one rule that replaced the filtering: a row the
 * server returned is listed, whatever this tab's cached cushion makes of it.
 */

import { describe, it, expect } from 'vitest';
import type { ShiftRecord } from '../services/api';
import { DEFAULT_SIGNUP_WINDOW, type SignupWindow } from './shiftBoard';
import { closeoutQueue, waitingLabel } from './closeoutQueue';

const NOW = Date.parse('2026-09-05T12:00:00Z');

const WINDOW: SignupWindow = { ...DEFAULT_SIGNUP_WINDOW, openEndedCushionHours: 12 };

const shift = (over: Partial<ShiftRecord> & { id: string }): ShiftRecord => ({
  organization_id: 'org-1',
  shift_date: '2026-09-04',
  start_time: '2026-09-04T08:00:00Z',
  end_time: '2026-09-04T20:00:00Z',
  attendee_count: 2,
  call_count: 0,
  is_finalized: false,
  created_at: '2026-09-04T00:00:00Z',
  updated_at: '2026-09-04T00:00:00Z',
  ...over,
});

describe('closeoutQueue', () => {
  it('dates a shift with a recorded end from that end', () => {
    const queue = closeoutQueue([shift({ id: 'a' })], WINDOW, NOW);

    expect(queue).toHaveLength(1);
    expect(queue[0]?.shift.id).toBe('a');
    expect(queue[0]?.waitingHours).toBe(16);
    expect(queue[0]?.openEnded).toBe(false);
  });

  it('dates an open-ended shift from the end of its cushion, not its start', () => {
    const queue = closeoutQueue(
      [shift({ id: 'a', start_time: '2026-09-04T20:00:00Z', end_time: undefined })],
      WINDOW,
      NOW
    );

    expect(queue).toHaveLength(1);
    expect(queue[0]?.openEnded).toBe(true);
    // Over at 08:00 (20:00 + 12h cushion), not at 20:00 the night before.
    expect(queue[0]?.waitingHours).toBe(4);
  });

  // The cushion is the department's, so a longer one makes the same shift a
  // shorter wait. It no longer decides whether the row appears at all.
  it('honours a longer cushion in the wait it reports', () => {
    const rows = [shift({ id: 'a', start_time: '2026-09-04T20:00:00Z', end_time: undefined })];

    expect(closeoutQueue(rows, { ...WINDOW, openEndedCushionHours: 12 }, NOW)[0]?.waitingHours).toBe(4);
    expect(closeoutQueue(rows, { ...WINDOW, openEndedCushionHours: 24 }, NOW)[0]?.waitingHours).toBe(0);
  });

  // The finding this replaced the filtering for. The cushion comes from
  // settings this tab caches, so an officer who lowers it elsewhere leaves
  // every other open tab holding the old number. Re-testing the server's answer
  // against that stale one dropped rows the server had just declared overdue —
  // and the page then said "Every shift is closed out" with a positive total
  // beside it. A row the server returned is listed.
  it('lists a row the server returned even when this tab’s cushion disagrees', () => {
    // Started six hours ago: over on a 12-hour cushion only in the future, so
    // the old filter dropped it outright.
    const rows = [shift({ id: 'a', start_time: '2026-09-05T06:00:00Z', end_time: undefined })];

    const queue = closeoutQueue(rows, WINDOW, NOW);

    expect(queue.map((entry) => entry.shift.id)).toEqual(['a']);
    expect(queue[0]?.waitingHours).toBe(0);
  });

  // Same rule, the states the old filter tested one at a time. The server
  // excludes all three; if one ever reaches this function it is listed rather
  // than silently dropped, because a row vanishing with no explanation is the
  // failure mode this page exists to avoid.
  it.each([
    ['finalized', { is_finalized: true }],
    ['cancelled', { status: 'cancelled' as const }],
    ['not yet ended', { start_time: '2026-09-05T14:00:00Z', end_time: '2026-09-06T02:00:00Z' }],
  ])('lists a %s row rather than second-guessing the server', (unused, over) => {
    expect(closeoutQueue([shift({ id: 'a', ...over })], WINDOW, NOW)).toHaveLength(1);
  });

  // An unreadable time used to drop the row: NaN compares false in both
  // directions, so it had to be excluded explicitly. Now only the badge goes
  // unknown — the row is the server's to include.
  it('keeps a row whose end cannot be read, with no wait to report', () => {
    const [entry, ...rest] = closeoutQueue([shift({ id: 'a', start_time: '08:00', end_time: '20:00' })], WINDOW, NOW);

    expect(rest).toEqual([]);
    expect(entry).toBeDefined();
    expect(entry?.waitingHours).toBeNull();
    expect(entry && waitingLabel(entry)).toBe('an unknown time');
  });

  // The endpoint orders by the end *it* computed. Re-sorting by the end this
  // tab computes would interleave rows differently from the list the server
  // paged, so a page boundary could repeat or skip one.
  it('preserves the order the server sent', () => {
    const queue = closeoutQueue(
      [
        shift({ id: 'first', start_time: '2026-09-05T04:00:00Z', end_time: '2026-09-05T10:00:00Z' }),
        shift({ id: 'second', start_time: '2026-09-01T08:00:00Z', end_time: '2026-09-01T20:00:00Z' }),
      ],
      WINDOW,
      NOW
    );

    expect(queue.map((entry) => entry.shift.id)).toEqual(['first', 'second']);
  });
});

describe('waitingLabel', () => {
  const label = (hours: number | null) => waitingLabel({ waitingHours: hours } as never);

  it('reads in hours below a day and days above it', () => {
    expect(label(0)).toBe('under an hour');
    expect(label(1)).toBe('1 hour');
    expect(label(16)).toBe('16 hours');
    expect(label(24)).toBe('1 day');
    expect(label(72)).toBe('3 days');
  });

  // Never "under an hour": an absent answer read as no wait at all is the
  // mistake this series has made four times in four different places.
  it('says an unreadable wait is unknown rather than none', () => {
    expect(label(null)).toBe('an unknown time');
  });
});
