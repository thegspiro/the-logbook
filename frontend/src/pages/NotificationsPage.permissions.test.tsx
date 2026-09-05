/**
 * Which tabs the Notifications screen offers, and to whom.
 *
 * All four tabs used to hang off one gate, `notifications.view`, and that
 * grant was seeded to every member (the `member` position and the junior
 * ranks). So a rank-and-file firefighter opened Notifications and got the
 * Send Log — `GET /notifications/logs`, which was scoped to the organization
 * and not to the recipient, returning the subject and body of every
 * notification the department had sent anyone.
 *
 * The grant is revoked at the seed sites (and by migration `a1f7c34e9b02`
 * for departments already onboarded), and the endpoint now defaults to
 * `scope=mine` _(2026-09-04)_ so the tab is the caller's own delivery
 * history. That is their own data, so the tab is offered to every signed-in
 * member — but only ever asks for the `mine` scope, which is the half these
 * cover. The rest is that the remaining tabs still follow the permission each
 * one's contents actually need, on the deep link as well as the button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { render } from '@testing-library/react';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import NotificationsPage from './NotificationsPage';
import { notificationsService } from '../services/api';
import { NotificationLogScope } from '../constants/enums';

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
  it('gives a plain member their inbox and their own send log', async () => {
    renderAt('/notifications');

    expect(await tabNames()).toEqual(['My Notifications', 'Send Log']);
  });

  it('defaults a plain member to the inbox, not the send log', async () => {
    renderAt('/notifications');

    await tabNames();
    expect(selectedTab()).toBe('My Notifications');
  });

  it('lets a member reach their own Send Log by deep link', async () => {
    renderAt('/notifications?tab=log');

    await tabNames();
    expect(selectedTab()).toBe('Send Log');
  });

  it('only ever asks for the caller-scoped log, whatever the caller holds', async () => {
    // The organization-wide scope exists but is not what this screen renders.
    // Requesting it here would put every recipient's notification bodies back
    // on the tab for anyone holding notifications.manage.
    held = ['notifications.view', 'notifications.manage'];
    renderAt('/notifications?tab=log');

    await waitFor(() => expect(notificationsService.getLogs).toHaveBeenCalled());
    // The scope is what this pins; pagination params are another test's
    // business, and matching them exactly coupled this to that.
    expect(notificationsService.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ scope: NotificationLogScope.MINE })
    );
  });

  it('loads the send log for a member, whose rules request would 403', async () => {
    // The two fetches are separate so a member keeps their own log. Sharing
    // one Promise.all with the permission-gated rules/summary calls would
    // lose it to their rejection.
    vi.mocked(notificationsService.getRules).mockRejectedValue(new Error('403'));
    renderAt('/notifications?tab=log');

    await waitFor(() => expect(notificationsService.getLogs).toHaveBeenCalled());
    expect(notificationsService.getRules).not.toHaveBeenCalled();
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
