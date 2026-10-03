import type { NotificationLogRecord } from '../services/adminServices';

/**
 * Folding a run of same-category notifications into one stack.
 *
 * Validation prompts arrive one per event or shift, and follow-up alerts one
 * per report per officer, so a busy weekend can put a dozen near-identical
 * rows in front of an officer and push everything else off the screen. The
 * rows are not merged on the server — each still carries its own link and its
 * own read state — they are only presented as one stack that expands.
 *
 * Membership is by the raw `category`, not the display group: "Event" covers
 * reminders, updates and validations, and a stack mixing "your event starts
 * tomorrow" with "validate attendance" would hide the one that needs action.
 *
 * Pinned rows never stack: a pin asks for that one notification to stay in
 * front of the member. Read rows do stack, so marking a row read inside an
 * open stack does not make it jump out of the stack and across the list.
 */

/** A category needs at least this many rows before it folds into a stack. */
export const STACK_MIN_SIZE = 2;

export type InboxEntry =
  | { kind: 'single'; notification: NotificationLogRecord }
  | { kind: 'stack'; category: string; notifications: NotificationLogRecord[] };

/** Only an unpinned, categorized row can join a stack. */
export function isStackable(notification: NotificationLogRecord): boolean {
  return !notification.pinned && Boolean(notification.category);
}

/**
 * Group an already-ordered list into singles and stacks.
 *
 * Order is preserved: a stack takes the position of its first (newest) row,
 * and its rows keep their relative order inside it.
 */
export function groupNotificationsIntoStacks(
  notifications: readonly NotificationLogRecord[],
  minSize: number = STACK_MIN_SIZE
): InboxEntry[] {
  const byCategory = new Map<string, NotificationLogRecord[]>();
  for (const notification of notifications) {
    if (!isStackable(notification)) continue;
    const category = notification.category ?? '';
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(notification);
    else byCategory.set(category, [notification]);
  }

  const entries: InboxEntry[] = [];
  const emitted = new Set<string>();
  for (const notification of notifications) {
    const category = notification.category ?? '';
    const bucket = isStackable(notification) ? byCategory.get(category) : undefined;
    if (bucket && bucket.length >= minSize) {
      if (emitted.has(category)) continue;
      emitted.add(category);
      entries.push({ kind: 'stack', category, notifications: bucket });
    } else {
      entries.push({ kind: 'single', notification });
    }
  }
  return entries;
}

// Plural nouns for the categories most likely to pile up. Anything unlisted
// falls back to the humanized category, which is readable if less specific.
const STACK_NOUNS: Record<string, string> = {
  event_validation: 'attendance validations',
  attendance_request: 'attendance requests to review',
  attendance_request_update: 'updates to your attendance requests',
  shift_validation: 'shift validations',
  shift_report_followup: 'shift report follow-ups',
  event_reminder: 'event reminders',
  event_update: 'event updates',
  shift_reminder: 'shift reminders',
  shift_checkout_reminder: 'shift checkout reminders',
  shift_assignment: 'shift assignments',
  shift_swap: 'shift swap updates',
  action_items: 'action items',
  training_submission: 'training submissions awaiting approval',
  training_submission_update: 'updates to your training submissions',
  training: 'training updates',
  events: 'event notifications',
  scheduling: 'scheduling notifications',
  maintenance: 'maintenance notifications',
  members: 'member notifications',
};

/** "5 attendance validations", for a stack header or a dashboard row. */
export function describeStack(category: string, count: number): string {
  const noun = STACK_NOUNS[category] ?? `${category.split('_').filter(Boolean).join(' ')} notifications`;
  return `${count} ${noun}`;
}

/**
 * The unread count a stack should show.
 *
 * The server count covers pages the inbox has not loaded; the loaded count
 * covers the case where that request failed or a new row arrived since it
 * ran. Neither can be too high on its own account, so the larger is the
 * better answer.
 */
export function stackUnreadCount(
  notifications: readonly NotificationLogRecord[],
  serverCount: number | undefined
): number {
  const loaded = notifications.filter((n) => !n.read).length;
  return Math.max(loaded, serverCount ?? 0);
}
