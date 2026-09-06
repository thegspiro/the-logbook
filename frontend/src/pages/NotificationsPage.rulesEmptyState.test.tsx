/**
 * What an officer who can read the notification rules but not write them sees
 * when the department has none.
 *
 * `notifications.view` opens the Notification Rules tab; creating a rule is
 * `notifications.manage` on the server. Those are not the same population: 16
 * of the 21 seeded positions carrying view -- captains, lieutenants, the
 * treasurer, the secretary, the training and safety officers -- stop short of
 * manage. Every one of them read "Create your first notification rule" over a
 * card with no button on it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

const renderRulesTab = () =>
  render(
    <MemoryRouter initialEntries={['/notifications?tab=rules']}>
      <ConfirmProvider>
        <NotificationsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

const INVITATION = 'Create your first notification rule to start sending automated notifications.';

beforeEach(() => {
  held = [];
  vi.mocked(notificationsService.getMyNotifications).mockReset();
  vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({ logs: [], total: 0, skip: 0, limit: 20 });
  vi.mocked(notificationsService.getRules).mockReset();
  vi.mocked(notificationsService.getRules).mockResolvedValue({ rules: [], total: 0 });
  vi.mocked(notificationsService.getSummary).mockReset();
  vi.mocked(notificationsService.getSummary).mockResolvedValue({} as never);
  vi.mocked(notificationsService.getLogs).mockReset();
  vi.mocked(notificationsService.getLogs).mockResolvedValue({ logs: [], total: 0, skip: 0, limit: 50 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationRules empty state', () => {
  it('answers a view-only officer without inviting them to create a rule', async () => {
    held = ['notifications.view'];

    renderRulesTab();

    expect(await screen.findByText('No Notification Rules')).toBeInTheDocument();
    expect(screen.queryByText(INVITATION)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create Rule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Rule/ })).not.toBeInTheDocument();
  });

  it('still invites a manager to create the first rule', async () => {
    held = ['notifications.view', 'notifications.manage'];

    renderRulesTab();

    expect(await screen.findByText('No Notification Rules')).toBeInTheDocument();
    expect(screen.getByText(INVITATION)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Rule/ })).toBeInTheDocument();
  });

  it('reports a search that matches nothing to a view-only officer', async () => {
    held = ['notifications.view'];
    vi.mocked(notificationsService.getRules).mockResolvedValue({
      rules: [
        {
          id: 'r1',
          name: 'Drill reminder',
          trigger: 'event_reminder',
          category: 'events',
          enabled: true,
          description: '',
        },
      ] as never,
      total: 1,
    });

    renderRulesTab();

    await userEvent.type(await screen.findByLabelText('Search notification rules...'), 'zzz');

    expect(await screen.findByText('No rules match your search query.')).toBeInTheDocument();
  });

  it('closes an open Add Rule dialog if the manage permission is revoked', async () => {
    held = ['notifications.view', 'notifications.manage'];

    const { rerender } = renderRulesTab();

    await userEvent.click(await screen.findByRole('button', { name: /Add Rule/ }));
    expect(screen.getByText('Create Notification Rule')).toBeInTheDocument();

    held = ['notifications.view'];
    rerender(
      <MemoryRouter initialEntries={['/notifications?tab=rules']}>
        <ConfirmProvider>
          <NotificationsPage />
        </ConfirmProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Add Rule/ })).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Create Notification Rule')).not.toBeInTheDocument();
  });
});
