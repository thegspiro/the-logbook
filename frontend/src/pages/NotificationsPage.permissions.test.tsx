/**
 * Which tabs the Notifications screen offers, and to whom.
 *
 * All four tabs used to hang off one gate, `notifications.view`, and that
 * grant was seeded to every member (the `member` position and the junior
 * ranks). So a rank-and-file firefighter opened Notifications and got the
 * Send Log — `GET /notifications/logs`, which is scoped to the organization
 * and not to the recipient, returning the subject and body of every
 * notification the department has sent anyone.
 *
 * The grant is revoked at the seed sites (and by migration `a1f7c34e9b02`
 * for departments already onboarded). These cover the screen's half: that the
 * tabs follow the permission each one's contents actually need, on the deep
 * link as well as the button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { render } from '@testing-library/react';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import NotificationsPage from './NotificationsPage';
import { notificationsService } from '../services/api';

vi.mock('../services/api', () => ({
  notificationsService: {
    getRules: vi.fn(),
    getSummary: vi.fn(),
    getLogs: vi.fn(),
    getMyNotifications: vi.fn(),
    createRule: vi.fn(),
    toggleRule: vi.fn(),
  },
}));

/** Permissions the current test's user holds. Swapped per case. */
let held: string[] = [];

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: (permission: string) => held.includes(permission) }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

vi.mock('../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (s: unknown) => unknown) =>
    selector({ unreadCount: 0, decrement: vi.fn(), clear: vi.fn() }),
}));

vi.mock('../components/NotificationCard', () => ({ default: () => null }));

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmProvider>
        <NotificationsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

const tabNames = async (): Promise<string[]> => {
  await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
  return screen.getAllByRole('tab').map((tab) => (tab.textContent || '').trim());
};

const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent?.trim();

beforeEach(() => {
  held = [];
  vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({
    logs: [],
    total: 0,
    skip: 0,
    limit: 20,
  });
  vi.mocked(notificationsService.getRules).mockResolvedValue({ rules: [], total: 0 });
  vi.mocked(notificationsService.getSummary).mockResolvedValue({} as never);
  vi.mocked(notificationsService.getLogs).mockResolvedValue({ logs: [], total: 0, skip: 0, limit: 50 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationsPage tab permissions', () => {
  it('gives a plain member their inbox and nothing else', async () => {
    renderAt('/notifications');

    expect(await tabNames()).toEqual(['My Notifications']);
  });

  it('does not let a member reach the Send Log by deep link', async () => {
    // The tab is not rendered, so the URL is the only way in. It must land on
    // the inbox rather than falling through to an admin tab.
    renderAt('/notifications?tab=log');

    await tabNames();
    expect(selectedTab()).toBe('My Notifications');
    expect(notificationsService.getLogs).not.toHaveBeenCalled();
  });

  it('still fetches the inbox for a member, which needs no permission', async () => {
    // `GET /notifications/my` is gated on authentication alone, so revoking
    // notifications.view must not cost a member their own notifications.
    renderAt('/notifications');

    await waitFor(() => expect(notificationsService.getMyNotifications).toHaveBeenCalled());
  });

  it('gives a notifications.view holder Rules and the Send Log', async () => {
    held = ['notifications.view'];
    renderAt('/notifications');

    expect(await tabNames()).toEqual(['My Notifications', 'Notification Rules', 'Send Log']);
  });

  it('withholds Email Templates from a notifications.view holder', async () => {
    // The tab's only control navigates to /communications/email-templates,
    // which is behind `settings.manage` — offering it to a view-only holder
    // promised a screen and delivered Access Denied.
    held = ['notifications.view'];
    renderAt('/notifications?tab=templates');

    await tabNames();
    expect(screen.queryByRole('tab', { name: /email templates/i })).toBeNull();
    expect(selectedTab()).toBe('Notification Rules');
  });

  it('offers Email Templates to a settings.manage holder', async () => {
    held = ['notifications.view', 'settings.manage'];
    renderAt('/notifications?tab=templates');

    await tabNames();
    expect(selectedTab()).toBe('Email Templates');
  });
});
