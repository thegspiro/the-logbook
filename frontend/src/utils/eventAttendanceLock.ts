/**
 * What a finalized event's edit form must leave alone.
 *
 * Finalizing an event credits each attendee's hours from its schedule and
 * check-in rules, so the backend refuses any save that would change them until
 * someone who can reopen attendance reopens the event. The edit form disables
 * those controls on a finalized event, and the edit page leaves them out of the
 * save: the form would otherwise resend every one of them, and a value the
 * browser rounds or defaults differently from the stored one reads as a change.
 */
import type { EventUpdate } from '../types/event';

/**
 * Mirrors `ATTENDANCE_SENSITIVE_UPDATE_FIELDS` in
 * `backend/app/services/event_service.py`, which is the authority, limited to
 * the keys an `EventUpdate` can carry (the actual start and end are recorded
 * through their own endpoint). `test_attendance_locked_fields_parity.py` fails
 * the backend build when the two disagree.
 */
export const ATTENDANCE_LOCKED_EVENT_FIELDS = [
  'start_datetime',
  'end_datetime',
  'event_type',
  'custom_category',
  'check_in_window_type',
  'check_in_minutes_before',
  'check_in_minutes_after',
  'require_checkout',
] as const satisfies readonly (keyof EventUpdate)[];

/** A copy of an update payload without the fields a finalized event locks. */
export function withoutAttendanceLockedFields(data: EventUpdate): EventUpdate {
  const payload: EventUpdate = { ...data };
  for (const field of ATTENDANCE_LOCKED_EVENT_FIELDS) {
    delete payload[field];
  }
  return payload;
}
