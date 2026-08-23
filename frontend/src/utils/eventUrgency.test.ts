/**
 * Tests for the events-list urgency ladder and its formatters.
 *
 * Kept apart from eventHelpers.test.ts, which covers the label/colour lookups:
 * everything here is time-dependent and shares one frozen `NOW`.
 */

import { describe, it, expect } from 'vitest';
import {
  formatEventDuration,
  formatEventTimeRange,
  getEventUrgency,
  getRelativeDayLabel,
  isRosterFull,
  isUrgentEventState,
} from './eventHelpers';
import type { EventListItem } from '../types/event';

// Wednesday 2026-09-02, 18:00 UTC. Every case below is expressed relative to
// this instant, and formatted in UTC so the assertions do not depend on the
// machine's zone.
const NOW = new Date('2026-09-02T18:00:00.000Z');
const UTC = 'UTC';

const hoursFromNow = (hours: number): string => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const makeEvent = (overrides: Partial<EventListItem> = {}): EventListItem => ({
  id: 'evt-1',
  title: 'Ladder Company Drill',
  event_type: 'training',
  start_datetime: hoursFromNow(24),
  end_datetime: hoursFromNow(26),
  requires_rsvp: true,
  is_mandatory: false,
  is_cancelled: false,
  ...overrides,
});

describe('getEventUrgency', () => {
  it('returns live while the check-in window is open', () => {
    const event = makeEvent({
      start_datetime: hoursFromNow(-1),
      end_datetime: hoursFromNow(1),
      check_in_opens_at: hoursFromNow(-2),
      check_in_closes_at: hoursFromNow(1),
    });
    expect(getEventUrgency(event, NOW)).toBe('live');
  });

  it('does not return live once the check-in window has closed', () => {
    const event = makeEvent({
      start_datetime: hoursFromNow(-4),
      end_datetime: hoursFromNow(-2),
      check_in_opens_at: hoursFromNow(-5),
      check_in_closes_at: hoursFromNow(-2),
    });
    expect(getEventUrgency(event, NOW)).not.toBe('live');
  });

  it('ranks live above every other state', () => {
    // Mandatory, unanswered and in its check-in window: live must still win,
    // because checking in is the action that matters at this moment.
    const event = makeEvent({
      is_mandatory: true,
      start_datetime: hoursFromNow(-1),
      end_datetime: hoursFromNow(1),
      check_in_opens_at: hoursFromNow(-2),
      check_in_closes_at: hoursFromNow(1),
    });
    expect(getEventUrgency(event, NOW)).toBe('live');
  });

  it('returns missed for a past mandatory event with no attendance', () => {
    const event = makeEvent({
      is_mandatory: true,
      start_datetime: hoursFromNow(-30),
      end_datetime: hoursFromNow(-28),
      user_attended: false,
    });
    expect(getEventUrgency(event, NOW)).toBe('missed');
  });

  it('does not return missed when attendance was recorded', () => {
    const event = makeEvent({
      is_mandatory: true,
      start_datetime: hoursFromNow(-30),
      end_datetime: hoursFromNow(-28),
      user_attended: true,
      user_rsvp_status: 'going',
    });
    expect(getEventUrgency(event, NOW)).toBe('confirmed');
  });

  it('does not return missed when the backend did not project attendance', () => {
    // An absent user_attended means "not known", never "did not attend" —
    // otherwise an older backend accuses every member of missing everything.
    const event = makeEvent({
      is_mandatory: true,
      start_datetime: hoursFromNow(-30),
      end_datetime: hoursFromNow(-28),
    });
    expect(getEventUrgency(event, NOW)).toBe('routine');
  });

  it('returns action for an upcoming mandatory event with no RSVP', () => {
    expect(getEventUrgency(makeEvent({ is_mandatory: true }), NOW)).toBe('action');
  });

  it('returns action when an unanswered RSVP deadline is within 48 hours', () => {
    const event = makeEvent({ rsvp_deadline: hoursFromNow(12) });
    expect(getEventUrgency(event, NOW)).toBe('action');
  });

  it('does not return action for an RSVP deadline further out than 48 hours', () => {
    const event = makeEvent({
      start_datetime: hoursFromNow(200),
      end_datetime: hoursFromNow(202),
      rsvp_deadline: hoursFromNow(100),
    });
    expect(getEventUrgency(event, NOW)).toBe('routine');
  });

  it('does not return action for an RSVP deadline that has already passed', () => {
    // Nothing the member does now clears it, so the band must not offer it.
    const event = makeEvent({ rsvp_deadline: hoursFromNow(-1) });
    expect(getEventUrgency(event, NOW)).toBe('routine');
  });

  it('does not return action once the member has answered', () => {
    expect(getEventUrgency(makeEvent({ is_mandatory: true, user_rsvp_status: 'going' }), NOW)).toBe('confirmed');
    expect(getEventUrgency(makeEvent({ is_mandatory: true, user_rsvp_status: 'not_going' }), NOW)).toBe('declined');
  });

  it('returns waitlisted ahead of confirmed and declined', () => {
    expect(getEventUrgency(makeEvent({ user_rsvp_status: 'waitlisted' }), NOW)).toBe('waitlisted');
  });

  it('treats a "maybe" RSVP as routine rather than an outstanding action', () => {
    // The member has responded, so the band has nothing to clear.
    expect(getEventUrgency(makeEvent({ is_mandatory: true, user_rsvp_status: 'maybe' }), NOW)).toBe('routine');
  });

  it('returns routine for a cancelled event, whatever else is true of it', () => {
    const event = makeEvent({
      is_cancelled: true,
      is_mandatory: true,
      start_datetime: hoursFromNow(-1),
      end_datetime: hoursFromNow(1),
      check_in_opens_at: hoursFromNow(-2),
      check_in_closes_at: hoursFromNow(1),
    });
    expect(getEventUrgency(event, NOW)).toBe('routine');
  });

  it('returns routine for a draft event so an unpublished card never nags', () => {
    expect(getEventUrgency(makeEvent({ is_draft: true, is_mandatory: true }), NOW)).toBe('routine');
  });

  it('returns routine for an ordinary upcoming event', () => {
    expect(getEventUrgency(makeEvent(), NOW)).toBe('routine');
  });
});

describe('isUrgentEventState', () => {
  it('counts only live, action and missed as band-worthy', () => {
    expect(isUrgentEventState('live')).toBe(true);
    expect(isUrgentEventState('action')).toBe(true);
    expect(isUrgentEventState('missed')).toBe(true);
    expect(isUrgentEventState('confirmed')).toBe(false);
    expect(isUrgentEventState('waitlisted')).toBe(false);
    expect(isUrgentEventState('declined')).toBe(false);
    expect(isUrgentEventState('routine')).toBe(false);
  });
});

describe('isRosterFull', () => {
  it('is false when the event has no cap', () => {
    expect(isRosterFull(makeEvent({ going_count: 40 }))).toBe(false);
  });

  it('is true once confirmed attendance reaches the cap', () => {
    expect(isRosterFull(makeEvent({ max_attendees: 14, going_count: 14 }))).toBe(true);
  });

  it('is false below the cap', () => {
    expect(isRosterFull(makeEvent({ max_attendees: 14, going_count: 9 }))).toBe(false);
  });
});

describe('formatEventDuration', () => {
  it('formats a whole number of hours', () => {
    expect(formatEventDuration(hoursFromNow(0), hoursFromNow(2))).toBe('2h');
  });

  it('formats hours and minutes', () => {
    expect(formatEventDuration('2026-09-02T19:00:00Z', '2026-09-02T20:30:00Z')).toBe('1h 30m');
  });

  it('formats a sub-hour span in minutes', () => {
    expect(formatEventDuration('2026-09-02T19:00:00Z', '2026-09-02T19:45:00Z')).toBe('45m');
  });

  it('returns an empty string when the span is invalid or inverted', () => {
    expect(formatEventDuration('nonsense', hoursFromNow(2))).toBe('');
    expect(formatEventDuration(hoursFromNow(2), hoursFromNow(1))).toBe('');
    expect(formatEventDuration(hoursFromNow(1), hoursFromNow(1))).toBe('');
  });
});

describe('getRelativeDayLabel', () => {
  it('labels an evening event today as Tonight', () => {
    expect(getRelativeDayLabel('2026-09-02T23:00:00Z', NOW, UTC)).toBe('Tonight');
  });

  it('labels a same-day event before 5pm as Today, not Tonight', () => {
    // Viewed from the morning, so an afternoon event is still ahead.
    const morning = new Date('2026-09-02T09:00:00.000Z');
    expect(getRelativeDayLabel('2026-09-02T14:00:00Z', morning, UTC)).toBe('Today');
  });

  it('labels the next calendar day as Tomorrow', () => {
    expect(getRelativeDayLabel('2026-09-03T09:00:00Z', NOW, UTC)).toBe('Tomorrow');
  });

  it('returns null beyond the 48-hour window', () => {
    expect(getRelativeDayLabel('2026-09-05T19:00:00Z', NOW, UTC)).toBeNull();
  });

  it('returns null for an event that has already started', () => {
    expect(getRelativeDayLabel('2026-09-02T17:00:00Z', NOW, UTC)).toBeNull();
  });

  it('returns null for an unparseable date', () => {
    expect(getRelativeDayLabel('nonsense', NOW, UTC)).toBeNull();
  });

  it('does not call a 26-hour-out event Tonight because the clock time matches', () => {
    // 2026-09-03 20:00 is the day after NOW, so it is Tomorrow — not Tonight.
    expect(getRelativeDayLabel('2026-09-03T20:00:00Z', NOW, UTC)).toBe('Tomorrow');
  });
});

describe('formatEventTimeRange', () => {
  it('renders day, time range and duration', () => {
    const event = makeEvent({
      start_datetime: '2026-09-08T19:00:00Z',
      end_datetime: '2026-09-08T21:00:00Z',
    });
    expect(formatEventTimeRange(event, UTC, NOW)).toBe('Tue, Sep 8 · 7:00 – 9:00 PM · 2h');
  });

  it('substitutes the relative label for an imminent event', () => {
    const event = makeEvent({
      start_datetime: '2026-09-03T19:00:00Z',
      end_datetime: '2026-09-03T21:00:00Z',
    });
    expect(formatEventTimeRange(event, UTC, NOW)).toBe('Tomorrow · 7:00 – 9:00 PM · 2h');
  });

  it('keeps both meridiems when the event crosses noon or midnight', () => {
    // Dropping the first one here would read as "11:30 – 1:00 PM", which says
    // the event started at half past eleven in the evening.
    const event = makeEvent({
      start_datetime: '2026-09-08T11:30:00Z',
      end_datetime: '2026-09-08T13:00:00Z',
    });
    expect(formatEventTimeRange(event, UTC, NOW)).toBe('Tue, Sep 8 · 11:30 AM – 1:00 PM · 1h 30m');
  });

  it('omits the duration when the span is invalid', () => {
    const event = makeEvent({
      start_datetime: '2026-09-08T19:00:00Z',
      end_datetime: '2026-09-08T19:00:00Z',
    });
    expect(formatEventTimeRange(event, UTC, NOW)).toBe('Tue, Sep 8 · 7:00 – 7:00 PM');
  });
});
