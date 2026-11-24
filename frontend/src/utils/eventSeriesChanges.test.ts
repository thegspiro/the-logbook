import { describe, it, expect } from 'vitest';
import { onlyChangedSeriesFields } from './eventSeriesChanges';
import type { Event } from '../types/event';

const loaded: Event = {
  id: 'evt-1',
  organization_id: 'org-1',
  title: 'Monday Drill',
  description: 'Bring gloves',
  event_type: 'training',
  start_datetime: '2026-03-16T23:00:00+00:00',
  end_datetime: '2026-03-17T01:00:00+00:00',
  rsvp_deadline: '2026-03-15T23:00:00Z',
  requires_rsvp: true,
  is_mandatory: false,
  allow_guests: false,
  send_reminders: true,
  reminder_target: 'all',
  reminder_schedule: [24],
  is_cancelled: false,
  created_at: '2026-01-20T10:00:00Z',
  updated_at: '2026-01-20T10:00:00Z',
};

describe('onlyChangedSeriesFields', () => {
  it('reads the same instant in another format as unchanged', () => {
    expect(
      onlyChangedSeriesFields(
        {
          start_datetime: '2026-03-16T23:00:00.000Z',
          end_datetime: '2026-03-17T01:00:00.000Z',
          rsvp_deadline: '2026-03-15T23:00:00.000Z',
        },
        loaded
      )
    ).toEqual({});
  });

  it('sends all three timing fields when one of them moves', () => {
    const moved = {
      start_datetime: '2026-03-16T23:30:00.000Z',
      end_datetime: '2026-03-17T01:00:00.000Z',
      rsvp_deadline: '2026-03-15T23:00:00.000Z',
    };

    expect(onlyChangedSeriesFields(moved, loaded)).toEqual(moved);
  });

  it('treats null, an empty string, a missing value and an empty list alike', () => {
    expect(
      onlyChangedSeriesFields({ location_details: null, location: '', mandatory_membership_types: [] }, loaded)
    ).toEqual({});
  });

  it('keeps a cleared value, a changed list and the training details', () => {
    expect(
      onlyChangedSeriesFields(
        { description: null, reminder_schedule: [24, 2], training_details: { training_type: 'refresher' } },
        loaded
      )
    ).toEqual({ description: null, reminder_schedule: [24, 2], training_details: { training_type: 'refresher' } });
  });
});
