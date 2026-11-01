/**
 * The Send Log under `?status=failed`, the operations dashboard's
 * Notification failures link.
 *
 * That tile counts every recipient's deliveries that recorded an error and is
 * shown only to `notifications.manage` holders, so the page asks the server
 * for the organization-wide view with its failed filter — the tile's own
 * predicate — rather than filtering the caller's own log on the client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import NotificationsPage from './NotificationsPage';
import { notificationsService } from '../services/api';
import { NotificationLogScope } from '../constants/enums';

vi.mock('../services/api', () => ({
  notificationsService: {
    getRules: vi.fn(),
    getSummary: vi.fn(),
    getLogs: vi.fn(),
    markAllLogsRead: vi.fn(),
    getMyNotifications: vi.fn(),
    getMyUnreadCountsByCategory: vi.fn(),
  },
}));

const mockCheckPermission = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: (p: string) => mockCheckPermission(p) as boolean }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (state: unknown) => unknown) =>
    selector({ unreadCount: 0, decrement: vi.fn(), decrementBy: vi.fn(), clear: vi.fn() }),
}));

vi.mock('../components/NotificationCard', () => ({ default: () => null }));

const logRow = (overrides: Record<string, unknown>) => ({
  id: 'log-1',
  organization_id: 'org-1',
  channel: 'email',
  subject: 'Drill on Thursday',
  message: 'Bring turnout gear.',
  recipient_email: 'alex@example.test',
  recipient_name: 'Alex Brooks',
  delivered: true,
  read: false,
  pinned: false,
  sent_at: '2026-09-01T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
  ...overrides,
});

const failedRow = logRow({
  id: 'log-2',
  subject: 'Shift swap approved',
  recipient_name: 'Jo Rivera',
  delivered: false,
  error: '550 mailbox full',
});

let location = '';
const LocationProbe = () => {
  const here = useLocation();
  location = `${here.pathname}${here.search}`;
  return null;
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ConfirmProvider>
        <NotificationsPage />
        <LocationProbe />
      </ConfirmProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  mockCheckPermission.mockReset();
  mockCheckPermission.mockImplementation((p: string) => p === 'notifications.manage' || p === 'notifications.view');
  // The server applies the filter; answering by it is what proves the page
  // asked for the failed rows rather than receiving them by accident.
  vi.mocked(notificationsService.getLogs).mockReset();
  vi.mocked(notificationsService.getLogs).mockImplementation((params) =>
    Promise.resolve(
      params?.failed
        ? { logs: [failedRow], total: 1, skip: 0, limit: 50, next_cursor: null }
        : { logs: [logRow({}), failedRow], total: 2, skip: 0, limit: 50, next_cursor: null }
    )
  );
  vi.mocked(notificationsService.getMyNotifications).mockReset();
  vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({
    logs: [],
    total: 0,
    skip: 0,
    limit: 20,
    next_cursor: null,
  });
  vi.mocked(notificationsService.getMyUnreadCountsByCategory).mockReset();
  vi.mocked(notificationsService.getMyUnreadCountsByCategory).mockResolvedValue({ categories: {} });
  vi.mocked(notificationsService.getRules).mockReset();
  vi.mocked(notificationsService.getRules).mockResolvedValue({ rules: [], total: 0 });
  vi.mocked(notificationsService.getSummary).mockReset();
  vi.mocked(notificationsService.getSummary).mockResolvedValue({
    total_rules: 0,
    active_rules: 0,
    emails_sent_this_month: 0,
    notifications_sent_this_month: 0,
  });
  location = '';
});

describe('NotificationsPage — ?status=failed', () => {
  it('opens the Send Log on the department-wide failed deliveries, and says so', async () => {
    renderAt('/notifications?status=failed');

    expect(await screen.findByText('Shift swap approved')).toBeInTheDocument();
    expect(screen.queryByText('Drill on Thursday')).not.toBeInTheDocument();
    expect(notificationsService.getLogs).toHaveBeenCalledWith({
      scope: NotificationLogScope.ORGANIZATION,
      failed: true,
      limit: 50,
    });
    expect(screen.getByRole('tab', { name: /Send Log/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Showing only failed deliveries, for every member of the department.')).toBeInTheDocument();
    // Mark all as read clears the caller's whole log, not the rows on screen.
    expect(screen.queryByRole('button', { name: /mark all as read/i })).not.toBeInTheDocument();
  });

  it("falls back to the caller's own failed deliveries without notifications.manage", async () => {
    mockCheckPermission.mockReturnValue(false);
    renderAt('/notifications?status=failed');

    expect(await screen.findByText('Showing only your failed deliveries.')).toBeInTheDocument();
    expect(notificationsService.getLogs).toHaveBeenCalledWith({
      scope: NotificationLogScope.MINE,
      failed: true,
      limit: 50,
    });
  });

  it('clears the filter, keeping the Send Log open, from Show all deliveries', async () => {
    const user = userEvent.setup();
    renderAt('/notifications?status=failed');
    await screen.findByText('Shift swap approved');

    await user.click(screen.getByRole('button', { name: 'Show all deliveries' }));

    expect(await screen.findByText('Drill on Thursday')).toBeInTheDocument();
    expect(location).toBe('/notifications?tab=log');
    expect(notificationsService.getLogs).toHaveBeenLastCalledWith({ scope: NotificationLogScope.MINE, limit: 50 });
    expect(screen.queryByText(/Showing only/)).not.toBeInTheDocument();
  });

  it('asks for the unfiltered own log without the parameter, as before', async () => {
    renderAt('/notifications?tab=log');

    expect(await screen.findByText('Drill on Thursday')).toBeInTheDocument();
    expect(notificationsService.getLogs).toHaveBeenCalledWith({ scope: NotificationLogScope.MINE, limit: 50 });
    expect(notificationsService.getLogs).not.toHaveBeenCalledWith(expect.objectContaining({ failed: true }));
  });
});
