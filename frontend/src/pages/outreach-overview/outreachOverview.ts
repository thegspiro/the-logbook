/**
 * The Outreach Overview's rules, kept free of React so they can be tested on
 * their own: what is short of people, what is waiting to be closed out, how
 * the calendar's days are laid out, and the range each view fetches.
 *
 * Nothing here decides which events are outreach or how full a sheet is — the
 * server answers both (pitfall #29). These only sort and label its answers.
 */

import type { EventRequestListItem, OutreachCalendarItem } from '../../types/event';
import { localToUTC, toLocalDateString } from '../../utils/dateFormatting';
import { monthMatrix, toDateKey, weekDates } from '../../modules/scheduling/utils/shiftBoard';
import { INBOX_GROUPS } from '../event-requests/requestInbox';

export type CalendarView = 'week' | 'month';

/** How far back an unfinished close-out is still worth chasing, and how far ahead "upcoming" looks. */
export const CLOSEOUT_LOOKBACK_DAYS = 30;
export const UPCOMING_DAYS = 60;

/** Rows listed under each attention card before "View all". */
export const ATTENTION_LIST_LIMIT = 5;

/** A calendar date as a Date at local noon, so no timezone shift moves it a day. */
export const dateFromKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
};

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

/** The days a view draws: one Sunday-first week, or the fixed six-week month grid. */
export const viewDays = (view: CalendarView, visible: Date): Date[] =>
  view === 'week' ? weekDates(visible) : monthMatrix(visible.getFullYear(), visible.getMonth());

/** The date a step back or forward lands on: a week, or the first of a month. */
export const stepDate = (view: CalendarView, visible: Date, direction: -1 | 1): Date =>
  view === 'week'
    ? addDays(visible, 7 * direction)
    : new Date(visible.getFullYear(), visible.getMonth() + direction, 1, 12);

/**
 * The UTC range covering every drawn day, cut at midnight in the department's
 * timezone — the same calendar the items are bucketed by.
 */
export const rangeFor = (days: Date[], timezone: string): { start: string; end: string } => {
  const first = days[0] ?? new Date();
  const last = days[days.length - 1] ?? first;
  return {
    start: localToUTC(`${toDateKey(first)}T00:00`, timezone),
    end: localToUTC(`${toDateKey(addDays(last, 1))}T00:00`, timezone),
  };
};

/** The overview's attention window: thirty days behind today, sixty ahead. */
export const attentionRange = (todayKey: string, timezone: string): { start: string; end: string } => {
  const today = dateFromKey(todayKey);
  return {
    start: localToUTC(`${toDateKey(addDays(today, -CLOSEOUT_LOOKBACK_DAYS))}T00:00`, timezone),
    end: localToUTC(`${toDateKey(addDays(today, UPCOMING_DAYS + 1))}T00:00`, timezone),
  };
};

/** Items keyed by the department's calendar day of their start. */
export const itemsByDay = (items: OutreachCalendarItem[], timezone: string): Map<string, OutreachCalendarItem[]> => {
  const map = new Map<string, OutreachCalendarItem[]>();
  for (const item of items) {
    const key = toLocalDateString(new Date(item.start_datetime), timezone);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
};

/** Seats still open on the volunteer sheet and the crew together; 0 where neither exists. */
export const openSeats = (item: OutreachCalendarItem): number =>
  Math.max((item.volunteers_total ?? 0) - (item.volunteers_filled ?? 0), 0) +
  Math.max((item.crew_total ?? 0) - (item.crew_filled ?? 0), 0);

/** Not started yet, and something on it still needs a person. */
export const isShortStaffed = (item: OutreachCalendarItem, now: Date): boolean =>
  new Date(item.start_datetime) >= now && openSeats(item) > 0;

/**
 * Over, and nobody has finalized its attendance — which is what closes an
 * outreach event out (owner decision, 2026-11-20: completion on finalize). A
 * draft never happened as far as the department's record goes, so it is not
 * owed a close-out.
 */
export const isAwaitingCloseout = (item: OutreachCalendarItem, now: Date): boolean =>
  new Date(item.end_datetime) < now && !item.attendance_finalized && !item.is_draft;

export const isUpcoming = (item: OutreachCalendarItem, now: Date): boolean => new Date(item.start_datetime) >= now;

const REPLY_STATUSES = INBOX_GROUPS.find((group) => group.key === 'reply')?.statuses ?? [];

/** The requests board's "Needs a reply" group, oldest first: the longest wait is the most overdue. */
export const requestsAwaitingReply = (requests: EventRequestListItem[]): EventRequestListItem[] =>
  requests
    .filter((request) => REPLY_STATUSES.includes(request.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

export interface FillLabel {
  text: string;
  short: boolean;
}

/** "3 of 4 volunteers", "2 of 4 crew"; one entry per staffing kind the event has. */
export const fillLabels = (item: OutreachCalendarItem): FillLabel[] => {
  const labels: FillLabel[] = [];
  if (item.volunteers_total !== null && item.volunteers_filled !== null) {
    labels.push({
      text: `${item.volunteers_filled} of ${item.volunteers_total} volunteers`,
      short: item.volunteers_filled < item.volunteers_total,
    });
  }
  if (item.crew_total !== null && item.crew_filled !== null) {
    labels.push({
      text: `${item.crew_filled} of ${item.crew_total} crew`,
      short: item.crew_filled < item.crew_total,
    });
  }
  return labels;
};
