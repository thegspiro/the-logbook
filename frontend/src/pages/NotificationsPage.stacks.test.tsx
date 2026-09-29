/**
 * Stacked notifications in the inbox.
 *
 * One validation prompt arrives per event or shift, so a busy weekend can put
 * a dozen near-identical rows at the top of an officer's inbox. Rows sharing a
 * category fold into a stack; clearing it is one request that also covers the
 * rows on pages not loaded yet, so the badge has to move by what the server
 * marked, not by what the page holds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import NotificationsPage from './NotificationsPage';
import { notificationsService } from '../services/api';

const { decrementBy, decrement } = vi.hoisted(() => ({ decrementBy: vi.fn(), decrement: vi.fn() }));

vi.mock('../services/api', () => ({
  notificationsService: {
    getMyNotifications: vi.fn(),
    getMyUnreadCountsByCategory: vi.fn(),
    markMyCategoryRead: vi.fn(),
    getLogs: vi.fn(),
    markMyNotificationRead: vi.fn(),
    markAllMyNotificationsRead: vi.fn(),
    toggleMyNotificationPin: vi.fn(),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: () => false }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (state: unknown) => unknown) =>
    selector({ unreadCount: 9, decrement, decrementBy, clear: vi.fn() }),
}));

const row = (id: string, category: string | undefined, subject: string, overrides: Record<string, unknown> = {}) => ({
  id,
  organization_id: 'org-1',
  channel: 'in_app',
  category,
  subject,
  message: 'body',
  delivered: true,
  read: false,
  pinned: false,
  sent_at: '2026-09-01T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
  ...overrides,
});

const renderInbox = () =>
  render(
    <MemoryRouter initialEntries={['/notifications?tab=inbox']}>
      <ConfirmProvider>
        <NotificationsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  decrementBy.mockReset();
  decrement.mockReset();
  vi.mocked(notificationsService.getLogs).mockReset();
  vi.mocked(notificationsService.getLogs).mockResolvedValue({
    logs: [],
    total: 0,
    skip: 0,
    limit: 50,
    next_cursor: null,
  });
  vi.mocked(notificationsService.getMyNotifications).mockReset();
  vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({
    logs: [
      row('v1', 'event_validation', 'Validate attendance for Saturday Drill'),
      row('r1', 'event_reminder', 'Reminder: Business Meeting'),
      row('v2', 'event_validation', 'Validate attendance for Sunday Drill'),
      row('p1', 'event_validation', 'Validate attendance for Pinned Drill', { pinned: true }),
    ],
    total: 4,
    skip: 0,
    limit: 20,
    next_cursor: null,
  });
  vi.mocked(notificationsService.getMyUnreadCountsByCategory).mockReset();
  vi.mocked(notificationsService.getMyUnreadCountsByCategory).mockResolvedValue({
    categories: { event_validation: 5, event_reminder: 1 },
  });
  vi.mocked(notificationsService.markMyCategoryRead).mockReset();
  vi.mocked(notificationsService.markMyCategoryRead).mockResolvedValue({ marked_read: 5 });
});

describe('NotificationsPage stacked inbox', () => {
  it('folds a category into one stack counted by the server, and leaves pinned and lone rows alone', async () => {
    renderInbox();

    expect(await screen.findByText('5 attendance validations')).toBeInTheDocument();
    expect(screen.getByText('5 unread')).toBeInTheDocument();
    // A lone reminder and a pinned validation stay individual cards.
    expect(screen.getByText('Reminder: Business Meeting')).toBeInTheDocument();
    expect(screen.getByText('Validate attendance for Pinned Drill')).toBeInTheDocument();
    // The stack's members are hidden until it is opened.
    expect(screen.queryByText('Validate attendance for Sunday Drill')).not.toBeInTheDocument();
  });

  it('clears a stack in one request and moves the badge by what the server marked', async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.click(await screen.findByRole('button', { name: 'Mark all 5 attendance validations as read' }));

    await waitFor(() => expect(notificationsService.markMyCategoryRead).toHaveBeenCalledWith('event_validation'));
    // Five, not the two rows loaded: the other three were on later pages.
    expect(decrementBy).toHaveBeenCalledWith(5);
    expect(notificationsService.markMyNotificationRead).not.toHaveBeenCalled();
    // The stack stays, now read, and offers nothing further to clear.
    expect(await screen.findByText('2 attendance validations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /attendance validations as read/ })).not.toBeInTheDocument();
  });

  it('still stacks when the per-category count cannot be fetched', async () => {
    vi.mocked(notificationsService.getMyUnreadCountsByCategory).mockRejectedValue(new Error('offline'));
    renderInbox();

    expect(await screen.findByText('2 attendance validations')).toBeInTheDocument();
    expect(screen.getByText('2 unread')).toBeInTheDocument();
  });
});
