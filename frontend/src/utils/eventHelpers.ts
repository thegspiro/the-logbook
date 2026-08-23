/**
 * Event Helper Utilities
 *
 * Centralized helper functions for event-related operations
 * including type labels, status colors, and badge styling.
 */

import type { EventListItem, RSVPStatus } from '../types/event';
import { EVENT_RELATIVE_LABEL_WINDOW_MS, EVENT_RSVP_DEADLINE_SOON_MS } from '../constants/config';
import { formatDateCustom, formatTime, toLocalDateString } from './dateFormatting';

/**
 * Get human-readable label for event type
 */
export const getEventTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    business_meeting: 'Business Meeting',
    public_education: 'Public Education',
    training: 'Training',
    social: 'Social',
    fundraiser: 'Fundraiser',
    ceremony: 'Ceremony',
    recruitment: 'Recruitment',
    other: 'Other',
  };
  return labels[type] || type;
};

/**
 * Get Tailwind CSS classes for event type badge
 */
export const getEventTypeBadgeColor = (type: string): string => {
  const colors: Record<string, string> = {
    business_meeting: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
    public_education: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
    training: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400',
    social: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-400',
    fundraiser: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
    ceremony: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400',
    recruitment: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-400',
    other: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300',
  };
  return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300';
};

/**
 * Get human-readable label for RSVP status
 */
export const getRSVPStatusLabel = (status: RSVPStatus): string => {
  const labels: Record<RSVPStatus, string> = {
    going: 'Going',
    not_going: 'Not Going',
    maybe: 'Maybe',
    waitlisted: 'Waitlisted',
  };
  return labels[status];
};

/**
 * Get Tailwind CSS classes for RSVP status badge
 */
export const getRSVPStatusColor = (status: RSVPStatus): string => {
  const colors: Record<RSVPStatus, string> = {
    going: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
    not_going: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
    maybe: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
    waitlisted: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  };
  return colors[status];
};

/**
 * Get expiration status for certifications/trainings
 */
export const getExpirationStatus = (expirationDate: string): { status: string; color: string } => {
  const today = new Date();
  const expDate = new Date(expirationDate);
  if (isNaN(expDate.getTime())) {
    return { status: 'Unknown', color: 'text-gray-600 bg-gray-50' };
  }
  const daysUntilExpiry = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    return { status: 'Expired', color: 'text-red-600 bg-red-50' };
  }
  if (daysUntilExpiry <= 30) {
    return { status: `${daysUntilExpiry} days`, color: 'text-red-600 bg-red-50' };
  }
  if (daysUntilExpiry <= 60) {
    return { status: `${daysUntilExpiry} days`, color: 'text-yellow-600 bg-yellow-50' };
  }
  return { status: `${daysUntilExpiry} days`, color: 'text-green-600 bg-green-50' };
};

/**
 * Get progress bar color based on completion percentage
 */
export const getProgressBarColor = (percentage: number): string => {
  if (percentage >= 75) return 'bg-green-500';
  if (percentage >= 50) return 'bg-blue-500';
  if (percentage >= 25) return 'bg-yellow-500';
  return 'bg-red-500';
};

/**
 * Generate an ICS (iCalendar) file content string for an event.
 */
export function generateICSContent(event: {
  title: string;
  description?: string | null;
  location?: string | null;
  start_datetime: string;
  end_datetime: string;
  id: string;
}): string {
  const formatICSDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  };

  const escapeICS = (str: string): string => {
    return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  };

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Logbook//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${formatICSDate(event.start_datetime)}`,
    `DTEND:${formatICSDate(event.end_datetime)}`,
    `SUMMARY:${escapeICS(event.title)}`,
    `UID:${event.id}@thelogbook`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeICS(event.location)}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Trigger a download of an ICS file for the given event.
 */
export function downloadICSFile(event: {
  title: string;
  description?: string | null;
  location?: string | null;
  start_datetime: string;
  end_datetime: string;
  id: string;
}): void {
  const content = generateICSContent(event);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * How much an event is asking of the member right now.
 *
 * One derived value drives the card's left accent, its status strip, its
 * footer actions and whether it appears in the "Needs You" band — so the band
 * and the card it points at can never disagree about an event's state.
 */
export type EventUrgency =
  | 'live' // check-in window is open now
  | 'action' // needs an RSVP that has not been given
  | 'confirmed' // going
  | 'waitlisted'
  | 'declined' // not going
  | 'missed' // mandatory, over, and no attendance recorded
  | 'routine';

/** The three states the band surfaces; the rest resolve on the card alone. */
export const URGENT_EVENT_STATES: readonly EventUrgency[] = ['live', 'action', 'missed'];

export const isUrgentEventState = (urgency: EventUrgency): boolean => URGENT_EVENT_STATES.includes(urgency);

/**
 * Whether an unanswered RSVP is close enough to its deadline to be urgent.
 *
 * A deadline already past is not urgent — nothing the member does now clears
 * it, and a row that cannot be cleared is exactly what the band promises not
 * to show.
 */
const isRsvpDeadlineSoon = (event: EventListItem, nowMs: number): boolean => {
  if (!event.rsvp_deadline) return false;
  const deadline = Date.parse(event.rsvp_deadline);
  if (Number.isNaN(deadline)) return false;
  return deadline > nowMs && deadline - nowMs <= EVENT_RSVP_DEADLINE_SOON_MS;
};

/**
 * Classify an event by what it needs from the current member.
 *
 * Precedence is fixed: live -> missed -> action -> waitlisted -> confirmed ->
 * declined -> routine. Cancelled and draft events short-circuit to `routine`:
 * a cancelled event has nothing to answer, and a draft is a manager's
 * unpublished working copy that must never nag anyone.
 */
export function getEventUrgency(event: EventListItem, now: Date = new Date()): EventUrgency {
  const nowMs = now.getTime();

  if (event.is_cancelled || event.is_draft) return 'routine';

  const opensAt = event.check_in_opens_at ? Date.parse(event.check_in_opens_at) : NaN;
  const closesAt = event.check_in_closes_at ? Date.parse(event.check_in_closes_at) : NaN;
  if (!Number.isNaN(opensAt) && !Number.isNaN(closesAt) && nowMs >= opensAt && nowMs <= closesAt) {
    return 'live';
  }

  const endsAt = Date.parse(event.end_datetime);
  const hasEnded = !Number.isNaN(endsAt) && endsAt < nowMs;

  // `user_attended` is absent on responses from a backend that predates the
  // projection. Treating that as "no attendance recorded" would accuse every
  // member of missing every mandatory event, so an absent value means "not
  // known" and produces no `missed`.
  if (hasEnded && event.is_mandatory && event.user_attended === false) return 'missed';

  if (!hasEnded && !event.user_rsvp_status) {
    if (event.is_mandatory) return 'action';
    if (event.requires_rsvp && isRsvpDeadlineSoon(event, nowMs)) return 'action';
  }

  switch (event.user_rsvp_status) {
    case 'waitlisted':
      return 'waitlisted';
    case 'going':
      return 'confirmed';
    case 'not_going':
      return 'declined';
    default:
      return 'routine';
  }
}

/**
 * Whether the roster is full, so a new RSVP would land on the waitlist.
 *
 * `going_count` counts confirmed attendance only, which is what
 * `max_attendees` caps — a waitlisted or declined RSVP does not consume a slot.
 */
export function isRosterFull(event: EventListItem): boolean {
  if (!event.max_attendees || event.max_attendees <= 0) return false;
  return (event.going_count ?? 0) >= event.max_attendees;
}

/** Format a span as "2h", "1h 30m" or "45m". Returns '' for a bad span. */
export function formatEventDuration(startIso: string, endIso: string): string {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return '';

  const totalMinutes = Math.round((end - start) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * "Tonight" / "Tomorrow" for an event inside the next 48 hours, else null.
 *
 * Compared by calendar day in the member's timezone rather than by elapsed
 * hours: an event at 9am tomorrow is "Tomorrow" whether it is 20 hours away or
 * 10, and "Tonight" must not attach to something 26 hours out that happens to
 * fall in the same rolling day.
 */
export function getRelativeDayLabel(startIso: string, now: Date = new Date(), timezone?: string): string | null {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return null;

  const deltaMs = start - now.getTime();
  if (deltaMs < 0 || deltaMs > EVENT_RELATIVE_LABEL_WINDOW_MS) return null;

  const dayOf = (date: Date): string => toLocalDateString(date, timezone);
  const startDay = dayOf(new Date(start));
  const today = dayOf(now);

  if (startDay === today) {
    // Only the evening reads as "Tonight"; a 9am event today is just its time.
    const hour = Number(formatDateCustom(new Date(start), { hour: 'numeric', hour12: false }, timezone));
    return Number.isNaN(hour) || hour < 17 ? 'Today' : 'Tonight';
  }

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (startDay === dayOf(tomorrow)) return 'Tomorrow';

  return null;
}

/**
 * Join two formatted times, dropping the meridiem from the first when both
 * share it: "7:00 – 9:00 PM", not "7:00 PM – 9:00 PM".
 *
 * Not cosmetic. This row also carries the date and the duration, and on a
 * phone-width card the four redundant characters were the difference between
 * the row fitting and the end time being truncated away.
 */
const formatTimeSpan = (startTime: string, endTime: string): string => {
  if (!endTime || endTime === 'N/A') return startTime;

  const meridiem = /\s(AM|PM)$/i;
  const startMeridiem = meridiem.exec(startTime)?.[1];
  const endMeridiem = meridiem.exec(endTime)?.[1];
  const start =
    startMeridiem && endMeridiem && startMeridiem.toUpperCase() === endMeridiem.toUpperCase()
      ? startTime.replace(meridiem, '')
      : startTime;

  return `${start} – ${endTime}`;
};

/**
 * The card's time row: "Tue, Sep 1 · 7:00 – 9:00 PM · 2h", with the date
 * replaced by "Tonight" / "Tomorrow" when the event is imminent.
 */
export function formatEventTimeRange(
  event: Pick<EventListItem, 'start_datetime' | 'end_datetime'>,
  timezone?: string,
  now: Date = new Date()
): string {
  const dayLabel =
    getRelativeDayLabel(event.start_datetime, now, timezone) ??
    formatDateCustom(event.start_datetime, { weekday: 'short', month: 'short', day: 'numeric' }, timezone);

  const startTime = formatTime(event.start_datetime, timezone);
  const endTime = formatTime(event.end_datetime, timezone);
  const duration = formatEventDuration(event.start_datetime, event.end_datetime);

  const parts = [dayLabel, formatTimeSpan(startTime, endTime)];
  if (duration) parts.push(duration);
  return parts.join(' · ');
}
