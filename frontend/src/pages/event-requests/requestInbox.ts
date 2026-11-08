/**
 * The Requests tab's triage logic, kept free of React so it can be tested on
 * its own: which group a request sits in, how urgent its date is, how long ago
 * it arrived, and what the coordinator should do next.
 */

import type { EventRequestListItem, EventRequestStatus, PipelineTaskConfig } from '../../types/event';
import { daysBetween } from '../../utils/dateFormatting';

export type InboxGroupKey = 'reply' | 'working' | 'scheduled' | 'postponed' | 'closed';

export interface InboxGroup {
  key: InboxGroupKey;
  title: string;
  hint: string;
  statuses: EventRequestStatus[];
}

/**
 * Ordered by what needs doing first. Closed requests are their own group so
 * the screen can fold them away: they need nothing, and mixing them in was
 * what made the old flat list hard to read.
 */
export const INBOX_GROUPS: InboxGroup[] = [
  { key: 'reply', title: 'Needs a reply', hint: 'New, nobody has started on it yet', statuses: ['submitted'] },
  { key: 'working', title: 'In progress', hint: 'Working through the checklist', statuses: ['in_progress'] },
  { key: 'scheduled', title: 'Scheduled', hint: 'On the calendar', statuses: ['scheduled'] },
  { key: 'postponed', title: 'Postponed', hint: 'Waiting on a new date', statuses: ['postponed'] },
  {
    key: 'closed',
    title: 'Closed',
    hint: 'Completed, declined or cancelled',
    statuses: ['completed', 'declined', 'cancelled'],
  },
];

export type InboxScope = 'all' | 'mine' | 'unassigned';

/** A request is still open while anybody has something left to do on it. */
export const isOpenStatus = (status: EventRequestStatus): boolean =>
  status !== 'completed' && status !== 'declined' && status !== 'cancelled';

/**
 * The date this request is for, as an instant: the confirmed date once it is
 * scheduled, otherwise the earliest date the requester named. A "general
 * timeframe" or "flexible" request names none, so it has no date to count
 * down to.
 */
export const requestDate = (req: EventRequestListItem): string | null => {
  if (req.event_date) return req.event_date;
  if (req.date_flexibility === 'specific_dates' && req.preferred_date_start) return req.preferred_date_start;
  return null;
};

/** Within a week counts as soon: one weekly meeting away from being missed. */
export const URGENT_WITHIN_DAYS = 7;

export interface DateUrgency {
  days: number;
  label: string;
  urgent: boolean;
}

/**
 * "in 5 days" for an open request with a date. Null for a closed request,
 * which no longer has anything to be late for, and for one with no date.
 */
export const dateUrgency = (req: EventRequestListItem, timezone?: string): DateUrgency | null => {
  const date = requestDate(req);
  if (!date || !isOpenStatus(req.status)) return null;
  const days = daysBetween(date, timezone);
  if (Number.isNaN(days)) return null;
  const label =
    days === 0
      ? 'today'
      : days === 1
        ? 'tomorrow'
        : days > 1
          ? `in ${days} days`
          : days === -1
            ? 'yesterday'
            : `${-days} days ago`;
  return { days, label, urgent: days <= URGENT_WITHIN_DAYS };
};

/** How long ago the request arrived, in the coarsest unit that is still honest. */
export const receivedAge = (createdAt: string, timezone?: string): string => {
  const days = -daysBetween(createdAt, timezone);
  if (Number.isNaN(days) || days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
};

/** A request that has waited this long for a first reply is called out. */
export const STALE_REPLY_DAYS = 2;

export const awaitingReplyTooLong = (req: EventRequestListItem, timezone?: string): boolean =>
  req.status === 'submitted' && -daysBetween(req.created_at, timezone) >= STALE_REPLY_DAYS;

export interface TaskProgress {
  done: number;
  total: number;
}

/** Only tasks the department still configures count, so a retired task cannot hold a request at 3/2. */
export const taskProgress = (req: EventRequestListItem, tasks: PipelineTaskConfig[]): TaskProgress => ({
  done: tasks.filter((t) => req.task_completions?.[t.id]?.completed).length,
  total: tasks.length,
});

/**
 * The one thing that moves this request forward, in the coordinator's words.
 * Null when nothing is left to do.
 */
export const nextStep = (req: EventRequestListItem, tasks: PipelineTaskConfig[]): string | null => {
  switch (req.status) {
    case 'submitted':
      return req.assigned_to ? 'Reply to the requester and start work' : 'Assign a coordinator';
    case 'in_progress': {
      const open = tasks.find((t) => !req.task_completions?.[t.id]?.completed);
      return open ? open.label : 'Schedule the event';
    }
    case 'scheduled': {
      const filled = req.staffing_slots_filled;
      const total = req.staffing_slots_total;
      if (filled == null || total == null) return 'Open volunteer signups';
      const short = total - filled;
      return short > 0 ? `Find ${short} more ${short === 1 ? 'volunteer' : 'volunteers'}` : null;
    }
    case 'postponed':
      return 'Agree a new date';
    default:
      return null;
  }
};

export const matchesScope = (req: EventRequestListItem, scope: InboxScope, userId: string | undefined): boolean => {
  if (scope === 'mine') return !!userId && req.assigned_to === userId;
  if (scope === 'unassigned') return !req.assigned_to;
  return true;
};

/** Case-insensitive match on who asked, for whom, and what kind of event. */
export const matchesSearch = (req: EventRequestListItem, query: string, typeLabel: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [req.contact_name, req.organization_name, req.contact_email, typeLabel, req.assignee_name]
    .filter((v): v is string => !!v)
    .some((v) => v.toLowerCase().includes(q));
};

const byTime = (value: string | null | undefined): number => {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};

/**
 * Within a group, the request to look at first comes first: the oldest
 * unanswered request, the soonest event, the most recently closed.
 */
const ORDER: Record<InboxGroupKey, (a: EventRequestListItem, b: EventRequestListItem) => number> = {
  reply: (a, b) => byTime(a.created_at) - byTime(b.created_at),
  working: (a, b) => byTime(requestDate(a)) - byTime(requestDate(b)) || byTime(a.created_at) - byTime(b.created_at),
  scheduled: (a, b) => byTime(requestDate(a)) - byTime(requestDate(b)),
  postponed: (a, b) => byTime(a.created_at) - byTime(b.created_at),
  closed: (a, b) => byTime(b.created_at) - byTime(a.created_at),
};

export const groupRequests = (requests: EventRequestListItem[]): Record<InboxGroupKey, EventRequestListItem[]> => {
  const grouped: Record<InboxGroupKey, EventRequestListItem[]> = {
    reply: [],
    working: [],
    scheduled: [],
    postponed: [],
    closed: [],
  };
  for (const req of requests) {
    const group = INBOX_GROUPS.find((g) => g.statuses.includes(req.status));
    if (group) grouped[group.key].push(req);
  }
  for (const group of INBOX_GROUPS) grouped[group.key].sort(ORDER[group.key]);
  return grouped;
};
