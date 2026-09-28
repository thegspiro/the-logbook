import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import NotificationStack from './NotificationStack';
import type { NotificationLogRecord } from '../services/adminServices';

const row = (id: string, overrides: Partial<NotificationLogRecord> = {}): NotificationLogRecord => ({
  id,
  organization_id: 'org-1',
  channel: 'in_app',
  category: 'event_validation',
  subject: `Action Required: Validate attendance for Drill ${id}`,
  message: 'Please review.',
  delivered: true,
  read: false,
  pinned: false,
  sent_at: '2026-09-01T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
  ...overrides,
});

describe('NotificationStack', () => {
  const onMarkRead = vi.fn();
  const onTogglePin = vi.fn();
  const onMarkStackRead = vi.fn();

  beforeEach(() => {
    onMarkRead.mockReset();
    onTogglePin.mockReset();
    onMarkStackRead.mockReset();
    onMarkStackRead.mockResolvedValue(undefined);
  });

  const renderStack = (props: { notifications?: NotificationLogRecord[]; unreadCount?: number } = {}) =>
    renderWithRouter(
      <NotificationStack
        category="event_validation"
        notifications={props.notifications ?? [row('1'), row('2'), row('3')]}
        unreadCount={props.unreadCount ?? 3}
        onMarkRead={onMarkRead}
        onTogglePin={onTogglePin}
        onMarkStackRead={onMarkStackRead}
      />
    );

  it('collapses to one summary row showing the count and the newest subject', () => {
    renderStack();

    expect(screen.getByText('3 attendance validations')).toBeInTheDocument();
    expect(screen.getByText('3 unread')).toBeInTheDocument();
    expect(screen.getByText('Latest: Action Required: Validate attendance for Drill 1')).toBeInTheDocument();
    expect(screen.queryByText('Action Required: Validate attendance for Drill 2')).not.toBeInTheDocument();
  });

  it('expands to show every notification in the stack', async () => {
    const user = userEvent.setup();
    renderStack();

    await user.click(screen.getByRole('button', { expanded: false, name: /3 attendance validations/ }));

    expect(screen.getByText('Action Required: Validate attendance for Drill 1')).toBeInTheDocument();
    expect(screen.getByText('Action Required: Validate attendance for Drill 2')).toBeInTheDocument();
    expect(screen.getByText('Action Required: Validate attendance for Drill 3')).toBeInTheDocument();
  });

  it('clears the whole stack with one action', async () => {
    const user = userEvent.setup();
    renderStack();

    await user.click(screen.getByRole('button', { name: 'Mark all 3 attendance validations as read' }));

    expect(onMarkStackRead).toHaveBeenCalledWith('event_validation');
    expect(onMarkRead).not.toHaveBeenCalled();
  });

  it('says when more of the stack is on pages not yet loaded', async () => {
    const user = userEvent.setup();
    renderStack({ unreadCount: 8 });

    expect(screen.getByText('8 unread')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { expanded: false, name: /8 attendance validations/ }));

    expect(screen.getByText(/5 more unread in this group are further down/)).toBeInTheDocument();
  });

  it('offers no mark-all control once everything in it is read', () => {
    renderStack({ notifications: [row('1', { read: true }), row('2', { read: true })], unreadCount: 0 });

    expect(screen.getByText('2 attendance validations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as read/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/unread/)).not.toBeInTheDocument();
  });
});
