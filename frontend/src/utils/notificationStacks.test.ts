import { describe, it, expect } from 'vitest';
import type { NotificationLogRecord } from '../services/adminServices';
import { describeStack, groupNotificationsIntoStacks, stackUnreadCount } from './notificationStacks';

const row = (id: string, overrides: Partial<NotificationLogRecord> = {}): NotificationLogRecord => ({
  id,
  organization_id: 'org-1',
  channel: 'in_app',
  subject: `Subject ${id}`,
  delivered: true,
  read: false,
  pinned: false,
  sent_at: '2026-09-01T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
  ...overrides,
});

describe('groupNotificationsIntoStacks', () => {
  it('folds a category with two or more rows into one stack at its newest position', () => {
    const entries = groupNotificationsIntoStacks([
      row('a', { category: 'event_validation' }),
      row('b', { category: 'event_reminder' }),
      row('c', { category: 'event_validation' }),
      row('d', { category: 'event_validation' }),
    ]);

    expect(entries.map((e) => (e.kind === 'stack' ? `stack:${e.category}` : e.notification.id))).toEqual([
      'stack:event_validation',
      'b',
    ]);
    const stack = entries[0];
    expect(stack?.kind === 'stack' ? stack.notifications.map((n) => n.id) : []).toEqual(['a', 'c', 'd']);
  });

  it('leaves a lone row of a category as a single', () => {
    const lone = row('a', { category: 'shift_validation' });
    expect(groupNotificationsIntoStacks([lone])).toEqual([{ kind: 'single', notification: lone }]);
  });

  it('never stacks a pinned row', () => {
    // A pin is a request to keep one notification in front of the member.
    const entries = groupNotificationsIntoStacks([
      row('p', { category: 'event_validation', pinned: true }),
      row('a', { category: 'event_validation' }),
    ]);
    expect(entries.every((e) => e.kind === 'single')).toBe(true);
  });

  it('never stacks uncategorized rows together', () => {
    const entries = groupNotificationsIntoStacks([row('a'), row('b')]);
    expect(entries.every((e) => e.kind === 'single')).toBe(true);
  });

  it('keeps read rows in their stack so reading one does not move it', () => {
    const entries = groupNotificationsIntoStacks([
      row('a', { category: 'shift_validation', read: true }),
      row('b', { category: 'shift_validation' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('stack');
  });

  it('stacks by raw category, not by display group', () => {
    // Reminders and validations share the "Event" icon, but only one of them
    // needs action — a mixed stack would hide it.
    const entries = groupNotificationsIntoStacks([
      row('a', { category: 'event_validation' }),
      row('b', { category: 'event_reminder' }),
    ]);
    expect(entries.every((e) => e.kind === 'single')).toBe(true);
  });
});

describe('describeStack', () => {
  it('uses a specific noun for known categories', () => {
    expect(describeStack('event_validation', 4)).toBe('4 attendance validations');
  });

  it('names pending training submissions for what they are waiting on', () => {
    expect(describeStack('training_submission', 3)).toBe('3 training submissions awaiting approval');
  });

  it('humanizes an unknown category', () => {
    expect(describeStack('brand_new_thing', 2)).toBe('2 brand new thing notifications');
  });
});

describe('stackUnreadCount', () => {
  const rows = [row('a'), row('b'), row('c', { read: true })];

  it('prefers the server count when it covers rows not yet loaded', () => {
    expect(stackUnreadCount(rows, 7)).toBe(7);
  });

  it('falls back to the loaded unread rows when the server count is missing or behind', () => {
    expect(stackUnreadCount(rows, undefined)).toBe(2);
    expect(stackUnreadCount(rows, 1)).toBe(2);
  });
});
