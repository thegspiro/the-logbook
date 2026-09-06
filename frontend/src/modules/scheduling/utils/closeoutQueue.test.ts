/**
 * Which shifts the close-out queue lists, and how long each has waited.
 *
 * The case that matters most is the open-ended shift: it has no `end_time`, so
 * a naive "has it ended" reads true from the moment it starts and puts a crew
 * still working at the top of the backlog. The cushion is what stops that, and
 * it is the department's own number, not a constant here.
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
  it('lists a shift that ended without being finalized', () => {
    const queue = closeoutQueue([shift({ id: 'a' })], WINDOW, NOW);

    expect(queue).toHaveLength(1);
    expect(queue[0]?.shift.id).toBe('a');
    expect(queue[0]?.waitingHours).toBe(16);
    expect(queue[0]?.openEnded).toBe(false);
  });

  it('leaves out a shift somebody has already closed', () => {
    expect(closeoutQueue([shift({ id: 'a', is_finalized: true })], WINDOW, NOW)).toEqual([]);
  });

  // A cancelled shift did not run, so there is nothing to record about it.
  // Counting it makes a backlog nobody can ever clear.
  it('leaves out a cancelled shift', () => {
    expect(closeoutQueue([shift({ id: 'a', status: 'cancelled' })], WINDOW, NOW)).toEqual([]);
  });

  it('leaves out a shift that has not ended yet', () => {
    const queue = closeoutQueue(
      [shift({ id: 'a', start_time: '2026-09-05T14:00:00Z', end_time: '2026-09-06T02:00:00Z' })],
      WINDOW,
      NOW
    );

    expect(queue).toEqual([]);
  });

  // The failure this whole module exists to prevent: with no `end_time`, "has
  // it ended" reads true the instant the shift starts, so a crew still out
  // appears in the backlog and nothing clears it until they finalize a shift
  // they are still on.
  it('does not list an open-ended shift that is still inside its cushion', () => {
    const queue = closeoutQueue(
      [shift({ id: 'a', start_time: '2026-09-05T06:00:00Z', end_time: undefined })],
      WINDOW,
      NOW
    );

    expect(queue).toEqual([]);
  });

  it('lists an open-ended shift once the cushion has passed, and dates it from the cushion', () => {
    const queue = closeoutQueue(
      [shift({ id: 'a', start_time: '2026-09-04T20:00:00Z', end_time: undefined })],
      WINDOW,
      NOW
    );

    expect(queue).toHaveLength(1);
    expect(queue[0]?.openEnded).toBe(true);
    // Ended at 08:00 (20:00 + 12h cushion), not at 20:00 the night before.
    expect(queue[0]?.waitingHours).toBe(4);
  });

  // The cushion is the department's, so a longer one holds a shift out of the
  // queue that a shorter one would have listed.
  it('honours a longer cushion', () => {
    const rows = [shift({ id: 'a', start_time: '2026-09-04T20:00:00Z', end_time: undefined })];

    expect(closeoutQueue(rows, { ...WINDOW, openEndedCushionHours: 24 }, NOW)).toEqual([]);
    expect(closeoutQueue(rows, { ...WINDOW, openEndedCushionHours: 12 }, NOW)).toHaveLength(1);
  });

  // NaN compares false in both directions, so an unreadable time must be
  // excluded explicitly rather than left to the comparison.
  it('leaves out a shift whose end cannot be read', () => {
    expect(closeoutQueue([shift({ id: 'a', start_time: '08:00', end_time: '20:00' })], WINDOW, NOW)).toEqual([]);
  });

  it('puts the longest wait first', () => {
    const queue = closeoutQueue(
      [
        shift({ id: 'recent', start_time: '2026-09-05T04:00:00Z', end_time: '2026-09-05T10:00:00Z' }),
        shift({ id: 'old', start_time: '2026-09-01T08:00:00Z', end_time: '2026-09-01T20:00:00Z' }),
      ],
      WINDOW,
      NOW
    );

    expect(queue.map((entry) => entry.shift.id)).toEqual(['old', 'recent']);
  });
});

describe('waitingLabel', () => {
  const label = (hours: number) => waitingLabel({ waitingHours: hours } as never);

  it('reads in hours below a day and days above it', () => {
    expect(label(0)).toBe('under an hour');
    expect(label(1)).toBe('1 hour');
    expect(label(16)).toBe('16 hours');
    expect(label(24)).toBe('1 day');
    expect(label(72)).toBe('3 days');
  });
});
