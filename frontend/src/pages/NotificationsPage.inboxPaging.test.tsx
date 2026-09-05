/**
 * The inbox's "Load more", after it moved from offset to cursor.
 *
 * The inbox is newest-first and grows at the front, so an offset-derived
 * `skip` drifts the moment a notification arrives between two page requests:
 * the next page re-serves a row already held and steps over another. The
 * skipped row is the damaging half — nothing on the client can tell it went
 * missing. The server now hands back a cursor naming the last row of the page,
 * and the client passes it through untouched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import NotificationsPage from './NotificationsPage';
import { notificationsService } from '../services/api';

vi.mock('../services/api', () => ({
  notificationsService: {
    getMyNotifications: vi.fn(),
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
    selector({ unreadCount: 0, decrement: vi.fn(), clear: vi.fn() }),
}));

vi.mock('../components/NotificationCard', () => ({
  default: ({ notification }: { notification: { subject?: string } }) => <div>{notification.subject}</div>,
}));

const row = (id: string, subject: string) => ({
  id,
  organization_id: 'org-1',
  channel: 'in_app',
  subject,
  message: 'body',
  delivered: true,
  read: true,
  pinned: false,
  sent_at: '2026-09-01T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
});

beforeEach(() => {
  vi.mocked(notificationsService.getLogs).mockReset();
  vi.mocked(notificationsService.getLogs).mockResolvedValue({
    logs: [],
    total: 0,
    skip: 0,
    limit: 50,
    next_cursor: null,
  });
  vi.mocked(notificationsService.getMyNotifications).mockReset();
});

const renderInbox = () =>
  render(
    <MemoryRouter initialEntries={['/notifications']}>
      <ConfirmProvider>
        <NotificationsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('NotificationsPage inbox paging', () => {
  it('passes the server cursor back rather than an offset it derived', async () => {
    vi.mocked(notificationsService.getMyNotifications).mockResolvedValueOnce({
      logs: [row('n-1', 'Drill on Thursday')],
      total: 3,
      skip: 0,
      limit: 20,
      next_cursor: 'inbox-cursor-2',
    });
    renderInbox();

    const more = await screen.findByRole('button', { name: /load more/i });

    vi.mocked(notificationsService.getMyNotifications).mockResolvedValueOnce({
      logs: [row('n-2', 'Hydrant testing')],
      total: 3,
      skip: 0,
      limit: 20,
      next_cursor: null,
    });
    await userEvent.setup().click(more);

    expect(await screen.findByText('Hydrant testing')).toBeInTheDocument();
    // Appended, not replaced.
    expect(screen.getByText('Drill on Thursday')).toBeInTheDocument();
    expect(notificationsService.getMyNotifications).toHaveBeenLastCalledWith({
      include_read: true,
      cursor: 'inbox-cursor-2',
      limit: 20,
    });
  });

  it('stops offering Load more when the server issues no next cursor', async () => {
    // The end of the list is the server's statement. Comparing loaded rows
    // against `total` disagrees with it whenever a notification arrives
    // mid-paging — here the total claims nine more exist and the absent
    // cursor says otherwise.
    vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({
      logs: [row('n-1', 'Drill on Thursday')],
      total: 10,
      skip: 0,
      limit: 20,
      next_cursor: null,
    });
    renderInbox();

    await screen.findByText('Drill on Thursday');
    await waitFor(() => expect(notificationsService.getMyNotifications).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });
});
