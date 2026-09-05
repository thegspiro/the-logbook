/**
 * Which shifts the planning screen calls short.
 *
 * The rules under test are the board's, reached through `staffingGaps` — the
 * point of the file is that this screen cannot answer differently — plus the
 * one thing it deliberately answers differently: openness is judged for an
 * officer, who can still seat somebody after the member signup window closes.
 */

import { describe, it, expect } from 'vitest';
import type { ShiftRecord } from '../services/api';
import { staffingGaps, totalOpenSeats } from './staffingGaps';

const TODAY = new Date('2026-09-05T12:00:00Z');

const shift = (over: Partial<ShiftRecord> & { shift_date: string }): ShiftRecord =>
  ({
    id: over.id ?? `shift-${over.shift_date}-${Math.random().toString(36).slice(2, 8)}`,
    organization_id: 'org-1',
    start_time: `${over.shift_date}T08:00:00Z`,
    end_time: `${over.shift_date}T20:00:00Z`,
    attendee_count: 0,
    call_count: 0,
    is_finalized: false,
    created_at: `${over.shift_date}T00:00:00Z`,
    ...over,
  }) as ShiftRecord;

const seat = (userId: string, position: string | null = null) =>
  ({ user_id: userId, user_name: `Member ${userId}`, position, status: 'confirmed' }) as never;

describe('staffingGaps', () => {
  it('reports a shift carrying fewer people than its minimum', () => {
    const gaps = staffingGaps([shift({ shift_date: '2026-09-08', min_staffing: 4, roster: [seat('a')] })], TODAY);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.capacity).toBe(4);
    expect(gaps[0]?.filled).toBe(1);
    expect(gaps[0]?.openSeats).toBe(3);
  });

  it('counts a shift against its own seat list rather than a department default', () => {
    const gaps = staffingGaps(
      [
        shift({
          shift_date: '2026-09-08',
          min_staffing: 6,
          positions: [{ position: 'officer' }, { position: 'driver' }] as never,
          roster: [seat('a', 'officer'), seat('b', 'driver')],
        }),
      ],
      TODAY
    );

    expect(gaps).toEqual([]);
  });

  // "Crew size not set" is the absence of a staffing level, not one of them. A
  // department that configures neither would otherwise open this screen on a
  // list of every shift it has ever scheduled.
  it('does not call a shift short when it never said how big its crew is', () => {
    const gaps = staffingGaps([shift({ shift_date: '2026-09-08' })], TODAY);

    expect(gaps).toEqual([]);
  });

  it('skips a shift that is cancelled, finalized, or already past', () => {
    const gaps = staffingGaps(
      [
        shift({ shift_date: '2026-09-08', min_staffing: 4, status: 'cancelled' }),
        shift({ shift_date: '2026-09-08', min_staffing: 4, is_finalized: true }),
        shift({ shift_date: '2026-09-01', min_staffing: 4 }),
      ],
      TODAY
    );

    expect(gaps).toEqual([]);
  });

  /**
   * The divergence this module exists for. `shiftStatusInfo` zeroes open seats
   * once the *member* signup window has closed, which is right for a board
   * offering a claim button. An officer can still seat somebody, so a shift
   * starting in an hour is the most urgent row on this screen — and inheriting
   * the member's answer would have hidden it.
   */
  it('still reports a shift that has already started', () => {
    // Built from TODAY's own local date rather than a literal, so the day
    // comparison inside isShiftOpen does not depend on the runner's timezone.
    const localToday = new Date(TODAY.getTime() - TODAY.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const underway = shift({
      shift_date: localToday,
      start_time: new Date(TODAY.getTime() - 60 * 60000).toISOString(),
      end_time: new Date(TODAY.getTime() + 11 * 60 * 60000).toISOString(),
      min_staffing: 4,
      roster: [seat('a')],
    });

    expect(staffingGaps([underway], TODAY)).toHaveLength(1);
    expect(staffingGaps([underway], TODAY)[0]?.openSeats).toBe(3);
  });

  it('trusts the server tally when it exceeds the roster it was sent', () => {
    // attendee_count is the server's own count and is present on responses
    // served before the roster field existed; taking the roster alone would
    // report a full shift as short.
    const gaps = staffingGaps(
      [shift({ shift_date: '2026-09-08', min_staffing: 2, attendee_count: 2, roster: [] })],
      TODAY
    );

    expect(gaps).toEqual([]);
  });

  it('does not count a declined seat as filled', () => {
    const declined = { user_id: 'b', user_name: 'Member b', position: null, status: 'declined' } as never;
    const gaps = staffingGaps(
      [shift({ shift_date: '2026-09-08', min_staffing: 2, roster: [seat('a'), declined] })],
      TODAY
    );

    expect(gaps[0]?.openSeats).toBe(1);
  });

  it('lists the empty seats so a name can be put in one', () => {
    const gaps = staffingGaps(
      [
        shift({
          shift_date: '2026-09-08',
          positions: [{ position: 'officer' }, { position: 'driver' }, { position: 'firefighter' }] as never,
          roster: [seat('a', 'officer')],
        }),
      ],
      TODAY
    );

    expect(gaps[0]?.vacancies.map((v) => v.position)).toEqual(['driver', 'firefighter']);
  });

  it('puts the soonest shift first, and the emptiest first within a day', () => {
    const gaps = staffingGaps(
      [
        shift({ id: 'later', shift_date: '2026-09-10', min_staffing: 4 }),
        shift({
          id: 'sooner-less-short',
          shift_date: '2026-09-08',
          start_time: '2026-09-08T08:00:00Z',
          min_staffing: 2,
        }),
        shift({
          id: 'sooner-more-short',
          shift_date: '2026-09-08',
          start_time: '2026-09-08T08:00:00Z',
          min_staffing: 6,
        }),
      ],
      TODAY
    );

    expect(gaps.map((gap) => gap.shift.id)).toEqual(['sooner-more-short', 'sooner-less-short', 'later']);
  });

  it('adds up the seats waiting across every gap', () => {
    const gaps = staffingGaps(
      [
        shift({ shift_date: '2026-09-08', min_staffing: 4 }),
        shift({ shift_date: '2026-09-09', min_staffing: 2, roster: [seat('a')] }),
      ],
      TODAY
    );

    expect(totalOpenSeats(gaps)).toBe(5);
  });
});
