import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { render } from '@testing-library/react';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import NotificationsPage from './NotificationsPage';
import { notificationsService } from '../services/api';

const decrement = vi.fn();

vi.mock('../services/api', () => ({
  notificationsService: {
    getMyNotifications: vi.fn(),
    markMyNotificationRead: vi.fn(),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: () => false }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (state: unknown) => unknown) =>
    selector({ unreadCount: 1, decrement, clear: vi.fn() }),
}));

describe('NotificationsPage read state', () => {
  it('clears the card and decrements global unread state once when its CTA opens', async () => {
    vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({
      logs: [
        {
          id: 'notification-1',
          organization_id: 'org-1',
          channel: 'in_app',
          category: 'department_message',
          subject: 'Operations update',
          message: 'Please review.',
          action_url: '/messages/message-1',
          delivered: true,
          read: false,
          pinned: false,
          sent_at: '2026-08-26T12:00:00Z',
          created_at: '2026-08-26T12:00:00Z',
        },
      ],
      total: 1,
      skip: 0,
      limit: 20,
    });
    vi.mocked(notificationsService.markMyNotificationRead).mockResolvedValue({} as never);

    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <ConfirmProvider>
          <NotificationsPage />
        </ConfirmProvider>
      </MemoryRouter>
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { expanded: false }));
    await user.click(screen.getByRole('button', { name: /Read Message/ }));

    await waitFor(() => expect(notificationsService.markMyNotificationRead).toHaveBeenCalledTimes(1));
    expect(decrement).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Operations update')).toHaveClass('text-theme-text-muted');
  });
});
