/**
 * Workflow review W56: controls on the Notifications page a screen reader
 * could not use. The rule on/off button had no name at all, the create
 * dialog's Trigger Event label pointed at nothing, its error was never
 * announced, and the Send Log's channel filter showed which channel was
 * chosen by colour alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
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

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: () => true }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

vi.mock('../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (s: unknown) => unknown) =>
    selector({ unreadCount: 0, decrement: vi.fn(), clear: vi.fn() }),
}));

vi.mock('../components/NotificationCard', () => ({ default: () => null }));

const rule = {
  id: 'rule-1',
  organization_id: 'org-1',
  name: 'Event reminders',
  description: null,
  trigger: 'event_reminder',
  category: 'events',
  channel: 'in_app',
  enabled: true,
  enforced: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

describe('NotificationsPage controls (W56)', () => {
  beforeEach(() => {
    vi.mocked(notificationsService.getRules).mockReset();
    vi.mocked(notificationsService.getRules).mockResolvedValue({ rules: [rule], total: 1 } as never);
    vi.mocked(notificationsService.getSummary).mockReset();
    vi.mocked(notificationsService.getSummary).mockResolvedValue({
      total_rules: 1,
      active_rules: 1,
      emails_sent_this_month: 0,
      notifications_sent_this_month: 0,
    });
    vi.mocked(notificationsService.getLogs).mockReset();
    vi.mocked(notificationsService.getLogs).mockResolvedValue({ logs: [], total: 0, skip: 0, limit: 20 });
    vi.mocked(notificationsService.getMyNotifications).mockReset();
    vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({ logs: [], total: 0 } as never);
    window.history.pushState({}, '', '/notifications?tab=rules');
  });

  it('names the rule switch and says whether it is on', async () => {
    renderWithRouter(<NotificationsPage />);

    const toggle = await screen.findByRole('switch', { name: 'Event reminders: notifications on' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('labels the trigger and announces a refused create', async () => {
    const user = userEvent.setup();
    renderWithRouter(<NotificationsPage />);

    await user.click(await screen.findByRole('button', { name: /add rule/i }));
    expect(screen.getByLabelText('Trigger Event')).toHaveValue('event_reminder');

    await user.click(screen.getByRole('button', { name: 'Create Rule' }));
    // Announced through the field it is about (forms review F-3).
    expect(screen.getByRole('textbox', { name: /^Rule Name/ })).toHaveAccessibleDescription('Enter a rule name.');
  });

  describe('create rule dialog refusing a save', () => {
    beforeEach(() => {
      vi.mocked(notificationsService.createRule).mockReset();
      vi.mocked(notificationsService.createRule).mockResolvedValue({ ...rule, id: 'rule-2' } as never);
    });

    const openCreate = async (user: ReturnType<typeof userEvent.setup>) => {
      renderWithRouter(<NotificationsPage />);
      await user.click(await screen.findByRole('button', { name: /add rule/i }));
    };

    it('names the missing rule name under its field and focuses it', async () => {
      const user = userEvent.setup();
      await openCreate(user);
      await user.click(screen.getByRole('button', { name: 'Create Rule' }));

      const name = screen.getByRole('textbox', { name: /^Rule Name/ });
      expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(name).toHaveAttribute('aria-required', 'true');
      expect(name).toHaveAccessibleDescription('Enter a rule name.');
      expect(name).toHaveFocus();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(notificationsService.createRule).not.toHaveBeenCalled();
    });

    it('puts a 422 on the field the server names', async () => {
      vi.mocked(notificationsService.createRule).mockRejectedValue({
        response: { status: 422, data: { detail: [{ field: 'name', message: 'Value is too long.' }] } },
      });
      const user = userEvent.setup();
      await openCreate(user);
      await user.type(screen.getByRole('textbox', { name: /^Rule Name/ }), 'Drill notices');
      await user.click(screen.getByRole('button', { name: 'Create Rule' }));

      const name = await screen.findByRole('textbox', { name: /^Rule Name/, description: 'Value is too long.' });
      expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(name).toHaveFocus();
    });

    it('keeps a server failure inside the dialog', async () => {
      vi.mocked(notificationsService.createRule).mockRejectedValue(new Error('Rules service unavailable'));
      const user = userEvent.setup();
      await openCreate(user);
      await user.type(screen.getByRole('textbox', { name: /^Rule Name/ }), 'Drill notices');
      await user.click(screen.getByRole('button', { name: 'Create Rule' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Rules service unavailable');
      expect(screen.getByRole('dialog', { name: 'Create Notification Rule' })).toBeInTheDocument();
    });
  });

  it('marks the chosen Send Log channel as pressed', async () => {
    window.history.pushState({}, '', '/notifications?tab=log');
    const user = userEvent.setup();
    renderWithRouter(<NotificationsPage />);

    expect(await screen.findByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Email' }));
    expect(screen.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });
});
