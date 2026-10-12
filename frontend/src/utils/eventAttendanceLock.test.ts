import { describe, it, expect } from 'vitest';

import type { EventUpdate } from '../types/event';
import { ATTENDANCE_LOCKED_EVENT_FIELDS, withoutAttendanceLockedFields } from './eventAttendanceLock';

// A fresh copy per test: one shared object, stripped in place by a broken
// implementation, would let the no-mutation test compare damage with damage.
const formSave = (): EventUpdate => ({
  title: 'Ladder drill (corrected)',
  description: 'Bring gloves',
  event_type: 'training',
  custom_category: 'Drills',
  start_datetime: '2026-09-12T13:00:00.000Z',
  end_datetime: '2026-09-12T16:00:00.000Z',
  check_in_window_type: 'flexible',
  check_in_minutes_before: 60,
  check_in_minutes_after: 15,
  require_checkout: false,
  attendee_visibility: null,
  is_mandatory: true,
});

describe('withoutAttendanceLockedFields', () => {
  it('removes every locked field', () => {
    const payload = withoutAttendanceLockedFields(formSave());

    for (const field of ATTENDANCE_LOCKED_EVENT_FIELDS) {
      expect(payload).not.toHaveProperty(field);
    }
  });

  it('keeps everything else, including an explicit null', () => {
    expect(withoutAttendanceLockedFields(formSave())).toEqual({
      title: 'Ladder drill (corrected)',
      description: 'Bring gloves',
      attendee_visibility: null,
      is_mandatory: true,
    });
  });

  it('leaves the payload it was given untouched', () => {
    const given = formSave();

    withoutAttendanceLockedFields(given);

    expect(given).toEqual(formSave());
  });
});
