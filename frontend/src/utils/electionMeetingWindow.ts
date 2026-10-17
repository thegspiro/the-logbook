import type { EventListItem } from '../types/event';
import type { MeetingRecord } from '../services/documentsService';
import { formatForDateTimeInput } from './dateFormatting';

/**
 * The voting window an election takes from the meeting or event it is linked
 * to, as `datetime-local` strings in the department zone (the form the
 * election date inputs and `localToUTC` work in).
 *
 * A minutes record keeps a wall-clock date and time with no zone — it is
 * typed and shown as the department's local time — so it is joined as text
 * rather than parsed with `new Date`, which would read it in the browser's
 * zone. An event's times are UTC instants and are converted.
 *
 * `start` is null when the record has no start time: a date alone does not say
 * when voting should open, so the caller leaves the election's dates alone.
 * `end` is null when there is no end time, or one that is not after the start.
 */
export interface MeetingWindow {
  start: string | null;
  end: string | null;
}

const hhmm = (time: string | undefined): string | null => (time ? time.slice(0, 5) : null);

export const meetingWindow = (
  meeting: Pick<MeetingRecord, 'meeting_date' | 'start_time' | 'end_time'>
): MeetingWindow => {
  const day = meeting.meeting_date.slice(0, 10);
  const startTime = hhmm(meeting.start_time);
  if (!day || !startTime) return { start: null, end: null };
  const start = `${day}T${startTime}`;
  const endTime = hhmm(meeting.end_time);
  const end = endTime ? `${day}T${endTime}` : null;
  return { start, end: end && end > start ? end : null };
};

export const eventWindow = (
  event: Pick<EventListItem, 'start_datetime' | 'end_datetime'>,
  timezone: string
): MeetingWindow => {
  const start = formatForDateTimeInput(event.start_datetime, timezone) || null;
  if (!start) return { start: null, end: null };
  const end = formatForDateTimeInput(event.end_datetime, timezone) || null;
  return { start, end: end && end > start ? end : null };
};
