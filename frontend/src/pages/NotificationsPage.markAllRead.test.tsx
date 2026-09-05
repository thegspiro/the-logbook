/**
 * "Mark all as read" against the inbox's unread-only filter.
 *
 * The inbox is a filtered list, so marking everything read is not a field
 * update on the rows it holds — with "Show read" unchecked those rows stop
 * belonging to it. Both handlers used to map them to `read: true` in place,
 * which left the unread-only view listing read notifications, and
 * `inboxTotal` is the count of that same filtered set, so the Load more
 * control kept offering rows that were no longer in it.
 *
 * Both entry points are covered: the Send Log's button (which clears every
 * channel, so it reaches these same in-app rows) and the inbox's own, which
 * carried the defect first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import NotificationsPage from './NotificationsPage';
import { notificationsService } from '../services/api';

vi.mock('../services/api', () => ({
  notificationsService: {
    getLogs: vi.fn(),
    markAllLogsRead: vi.fn(),
    getMyNotifications: vi.fn(),
    markAllMyNotificationsRead: vi.fn(),
    markMyNotificationRead: vi.fn(),
    toggleMyNotificationPin: vi.fn(),
  },
}));

const clearGlobalUnread = vi.fn();

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: () => false }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (state: unknown) => unknown) =>
    selector({ unreadCount: 2, decrement: vi.fn(), clear: clearGlobalUnread }),
}));

/** Renders the subject line so an assertion has something to look for. */
vi.mock('../components/NotificationCard', () => ({
  default: ({ notification }: { notification: { subject?: string } }) => <div>{notification.subject}</div>,
}));

const unread = {
  id: 'notification-1',
  organization_id: 'org-1',
  channel: 'in_app',
  subject: 'Drill on Thursday',
  message: 'Bring turnout gear.',
  delivered: true,
  read: false,
  pinned: false,
  sent_at: '2026-09-01T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
};

const logRow = { ...unread, id: 'log-1', channel: 'email', recipient_email: 'me@example.test' };

beforeEach(() => {
  clearGlobalUnread.mockReset();

  vi.mocked(notificationsService.getMyNotifications).mockReset();
  // The unread-only view is a narrower query, not a client-side filter, so
  // the mock has to answer include_read the way the endpoint does.
  vi.mocked(notificationsService.getMyNotifications).mockImplementation((params) =>
    Promise.resolve({ logs: [unread], total: 1, skip: 0, limit: params?.include_read === false ? 20 : 20 })
  );

  vi.mocked(notificationsService.getLogs).mockReset();
  vi.mocked(notificationsService.getLogs).mockResolvedValue({ logs: [logRow], total: 1, skip: 0, limit: 50 });

  vi.mocked(notificationsService.markAllLogsRead).mockReset();
  vi.mocked(notificationsService.markAllLogsRead).mockResolvedValue({ marked_read: 2 });

  vi.mocked(notificationsService.markAllMyNotificationsRead).mockReset();
  vi.mocked(notificationsService.markAllMyNotificationsRead).mockResolvedValue({ marked_read: 1 });
});

const renderPage = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmProvider>
        <NotificationsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

const uncheckShowRead = async (user: ReturnType<typeof userEvent.setup>) => {
  const toggle = await screen.findByRole('checkbox');
  await user.click(toggle);
  await waitFor(() =>
    expect(notificationsService.getMyNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ include_read: false })
    )
  );
};

const switchTo = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) =>
  user.click(await screen.findByRole('tab', { name }));

describe('NotificationsPage mark-all-read against the unread filter', () => {
  it('empties the unread-only inbox when the Send Log clears every channel', async () => {
    const user = userEvent.setup();
    renderPage('/notifications');

    await uncheckShowRead(user);
    expect(await screen.findByText('Drill on Thursday')).toBeInTheDocument();

    await switchTo(user, /send log/i);
    await user.click(await screen.findByRole('button', { name: /mark all as read/i }));
    await waitFor(() => expect(notificationsService.markAllLogsRead).toHaveBeenCalled());

    await switchTo(user, /my notifications/i);
    // The row was marked read, so it no longer belongs to an unread-only view.
    await waitFor(() => expect(screen.queryByText('Drill on Thursday')).toBeNull());
    expect(screen.getByText('No Unread Notifications')).toBeInTheDocument();
    expect(clearGlobalUnread).toHaveBeenCalled();
  });

  it('empties it from the inbox button too, and retires the Load more count', async () => {
    const user = userEvent.setup();
    renderPage('/notifications');

    await uncheckShowRead(user);
    expect(await screen.findByText('Drill on Thursday')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /mark all as read/i }));
    await waitFor(() => expect(notificationsService.markAllMyNotificationsRead).toHaveBeenCalled());

    await waitFor(() => expect(screen.queryByText('Drill on Thursday')).toBeNull());
    // inboxTotal counts the same filtered set, so a stale one keeps offering
    // rows the list no longer holds.
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('keeps the rows, marked read, when the inbox is showing read ones', async () => {
    const user = userEvent.setup();
    renderPage('/notifications');

    // "Show read" starts checked, so the list is unfiltered and the rows stay.
    expect(await screen.findByText('Drill on Thursday')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /mark all as read/i }));
    await waitFor(() => expect(notificationsService.markAllMyNotificationsRead).toHaveBeenCalled());

    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Drill on Thursday')).toBeInTheDocument();
  });
});
