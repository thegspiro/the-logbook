import { describe, it, expect } from 'vitest';
import type { EventRequestListItem, OutreachCalendarItem } from '../../types/event';
import {
  attentionRange,
  dateFromKey,
  fillLabels,
  isAwaitingCloseout,
  isShortStaffed,
  itemsByDay,
  openSeats,
  rangeFor,
  requestsAwaitingReply,
  stepDate,
  viewDays,
} from './outreachOverview';
import { toDateKey } from '../../modules/scheduling/utils/shiftBoard';

const TZ = 'America/New_York';
const NOW = new Date('2026-11-21T17:00:00Z');

const item = (overrides: Partial<OutreachCalendarItem> = {}): OutreachCalendarItem => ({
  event_id: 'e1',
  title: 'School visit',
  event_type: 'public_education',
  start_datetime: '2026-11-25T15:00:00Z',
  end_datetime: '2026-11-25T17:00:00Z',
  location: null,
  is_draft: false,
  request_id: null,
  request_organization: null,
  volunteers_filled: null,
  volunteers_total: null,
  crew_filled: null,
  crew_total: null,
  unit_numbers: [],
  attendance_finalized: false,
  ...overrides,
});

const request = (overrides: Partial<EventRequestListItem>): EventRequestListItem => ({
  id: 'r1',
  contact_name: 'Pat',
  outreach_type: 'station_tour',
  status: 'submitted',
  date_flexibility: 'flexible',
  created_at: '2026-11-10T12:00:00Z',
  ...overrides,
});

describe('openSeats', () => {
  it('adds the open volunteer and crew seats', () => {
    expect(openSeats(item({ volunteers_filled: 2, volunteers_total: 4, crew_filled: 3, crew_total: 4 }))).toBe(3);
  });

  it('reads an event with no sheet and no crew as nothing open, not as empty', () => {
    expect(openSeats(item())).toBe(0);
  });

  it('never goes negative when more signed up than the sheet asks for', () => {
    expect(openSeats(item({ volunteers_filled: 5, volunteers_total: 4 }))).toBe(0);
  });
});

describe('isShortStaffed', () => {
  it('is an upcoming event with a seat still open', () => {
    expect(isShortStaffed(item({ volunteers_filled: 1, volunteers_total: 2 }), NOW)).toBe(true);
  });

  it('is not an event that already started', () => {
    const started = item({
      start_datetime: '2026-11-21T16:00:00Z',
      volunteers_filled: 1,
      volunteers_total: 2,
    });
    expect(isShortStaffed(started, NOW)).toBe(false);
  });

  it('is not a full event', () => {
    expect(isShortStaffed(item({ crew_filled: 4, crew_total: 4 }), NOW)).toBe(false);
  });
});

describe('isAwaitingCloseout', () => {
  const over = { start_datetime: '2026-11-18T15:00:00Z', end_datetime: '2026-11-18T17:00:00Z' };

  it('is an event that is over with attendance not finalized', () => {
    expect(isAwaitingCloseout(item(over), NOW)).toBe(true);
  });

  it('is not an event whose attendance is finalized', () => {
    expect(isAwaitingCloseout(item({ ...over, attendance_finalized: true }), NOW)).toBe(false);
  });

  it('is not a draft, which never happened on the record', () => {
    expect(isAwaitingCloseout(item({ ...over, is_draft: true }), NOW)).toBe(false);
  });

  it('is not an event still under way', () => {
    expect(isAwaitingCloseout(item({ end_datetime: '2026-11-21T18:00:00Z' }), NOW)).toBe(false);
  });
});

describe('requestsAwaitingReply', () => {
  it('keeps only the board’s "Needs a reply" group, the longest wait first', () => {
    const rows = requestsAwaitingReply([
      request({ id: 'new', created_at: '2026-11-20T12:00:00Z' }),
      request({ id: 'working', status: 'in_progress' }),
      request({ id: 'old', created_at: '2026-11-01T12:00:00Z' }),
      request({ id: 'done', status: 'completed' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['old', 'new']);
  });
});

describe('fillLabels', () => {
  it('labels each staffing kind the event has, and flags the short one', () => {
    expect(fillLabels(item({ volunteers_filled: 3, volunteers_total: 4, crew_filled: 2, crew_total: 2 }))).toEqual([
      { text: '3 of 4 volunteers', short: true },
      { text: '2 of 2 crew', short: false },
    ]);
  });

  it('has nothing to say of an event with neither', () => {
    expect(fillLabels(item())).toEqual([]);
  });
});

describe('itemsByDay', () => {
  it('files an evening event under the department’s day, not the UTC one', () => {
    // 23:30 in New York on the 25th is 04:30 UTC on the 26th.
    const late = item({ start_datetime: '2026-11-26T04:30:00Z', end_datetime: '2026-11-26T05:30:00Z' });
    const map = itemsByDay([late], TZ);
    expect([...map.keys()]).toEqual(['2026-11-25']);
  });

  it('keeps every event of a day together', () => {
    const map = itemsByDay([item({ event_id: 'a' }), item({ event_id: 'b' })], TZ);
    expect(map.get('2026-11-25')?.map((i) => i.event_id)).toEqual(['a', 'b']);
  });
});

describe('the calendar’s days', () => {
  const visible = dateFromKey('2026-11-21');

  it('draws one Sunday-first week, or the six-week month grid', () => {
    const week = viewDays('week', visible);
    expect(week.map(toDateKey)).toEqual([
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
    ]);
    const month = viewDays('month', visible);
    expect(month).toHaveLength(42);
    expect(toDateKey(month[0] ?? visible)).toBe('2026-11-01');
  });

  it('steps a week at a time, or to the first of the next month', () => {
    expect(toDateKey(stepDate('week', visible, 1))).toBe('2026-11-28');
    expect(toDateKey(stepDate('month', visible, 1))).toBe('2026-12-01');
    expect(toDateKey(stepDate('month', dateFromKey('2026-01-31'), -1))).toBe('2025-12-01');
  });

  it('fetches from midnight of the first day to midnight after the last, in the department’s timezone', () => {
    expect(rangeFor(viewDays('week', visible), TZ)).toEqual({
      start: '2026-11-15T05:00:00.000Z',
      end: '2026-11-22T05:00:00.000Z',
    });
  });

  it('looks thirty days back and sixty ahead for what needs attention', () => {
    expect(attentionRange('2026-11-21', TZ)).toEqual({
      start: '2026-10-22T04:00:00.000Z',
      end: '2027-01-21T05:00:00.000Z',
    });
  });
});
