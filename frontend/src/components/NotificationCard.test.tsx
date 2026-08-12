import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import NotificationCard from './NotificationCard';
import type { NotificationLogRecord } from '../services/adminServices';

function makeNotification(overrides: Partial<NotificationLogRecord> = {}): NotificationLogRecord {
  return {
    id: 'notif-1',
    organization_id: 'org-1',
    channel: 'in_app',
    sent_at: '2026-08-11T16:31:00Z',
    created_at: '2026-08-11T16:31:00Z',
    delivered: true,
    read: false,
    pinned: false,
    subject: 'Reminder: Recruit School — CPR / BLS Provider',
    message: 'Your event starts in 2 days.',
    ...overrides,
  };
}

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { expanded: false }));
}

describe('NotificationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('category label', () => {
    it('maps a notification-log category onto its display group', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <NotificationCard
          notification={makeNotification({ category: 'event_reminder' })}
          onMarkRead={vi.fn()}
          onTogglePin={vi.fn()}
        />
      );

      await expand(user);

      expect(screen.getByText('Event')).toBeInTheDocument();
    });

    it('never shows a raw underscored token for an unmapped category', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <NotificationCard
          notification={makeNotification({ category: 'brand_new_category' })}
          onMarkRead={vi.fn()}
          onTogglePin={vi.fn()}
        />
      );

      await expand(user);

      expect(screen.getByText('Brand New Category')).toBeInTheDocument();
      expect(screen.queryByText(/Brand_new_category/)).not.toBeInTheDocument();
    });

    it('falls back to a generic label when the category is absent', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <NotificationCard notification={makeNotification()} onMarkRead={vi.fn()} onTogglePin={vi.fn()} />
      );

      await expand(user);

      expect(screen.getByText('Notification')).toBeInTheDocument();
    });
  });

  describe('action buttons', () => {
    it('offers a way to reach the event an event reminder is about', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <NotificationCard
          notification={makeNotification({ category: 'event_reminder', action_url: '/events/evt-1' })}
          onMarkRead={vi.fn()}
          onTogglePin={vi.fn()}
        />
      );

      await expand(user);

      expect(screen.getByRole('button', { name: /View Event/ })).toBeInTheDocument();
    });

    it('offers only Pin when the notification carries no destination', async () => {
      const user = userEvent.setup();
      renderWithRouter(
        <NotificationCard
          notification={makeNotification({ category: 'event_reminder' })}
          onMarkRead={vi.fn()}
          onTogglePin={vi.fn()}
        />
      );

      await expand(user);

      expect(screen.queryByRole('button', { name: /View/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Pin/ })).toBeInTheDocument();
    });
  });

  describe('read state', () => {
    it('marks read on collapse, not on expand', async () => {
      const user = userEvent.setup();
      const onMarkRead = vi.fn();
      renderWithRouter(
        <NotificationCard
          notification={makeNotification({ category: 'event_reminder' })}
          onMarkRead={onMarkRead}
          onTogglePin={vi.fn()}
        />
      );

      await expand(user);
      expect(onMarkRead).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { expanded: true }));
      expect(onMarkRead).toHaveBeenCalledWith('notif-1');
    });
  });
});
