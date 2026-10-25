/**
 * Rules can be edited and deleted from the screen (W56-4 / NOTIF2-6).
 *
 * The API had PATCH and DELETE all along; the screen could only create and
 * toggle, so a typo or a rule on the wrong trigger stayed forever. Deleting is
 * not neutral: with no rule left for a trigger it goes back to sending with
 * its defaults, and with one enabled rule among disabled ones it stops. The
 * confirmation says which, before it happens.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({ checkPermission: () => true }),
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

vi.mock('../hooks/useNotificationCount', () => ({
  useNotificationCountStore: (selector: (s: unknown) => unknown) =>
    selector({ unreadCount: 0, decrement: vi.fn(), clear: vi.fn() }),
}));

vi.mock('../components/NotificationCard', () => ({ default: () => null }));

const rule = (overrides: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  organization_id: 'org-1',
  name: 'Event reminders',
  description: 'Remind members before drill night',
  trigger: 'event_reminder',
  category: 'events',
  channel: 'in_app',
  enabled: true,
  enforced: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...overrides,
});

const renderRules = (rules: Record<string, unknown>[]) => {
  vi.mocked(notificationsService.getRules).mockResolvedValue({ rules, total: rules.length } as never);
  renderWithRouter(<NotificationsPage />);
};

describe('Editing and deleting notification rules', () => {
  beforeEach(() => {
    vi.mocked(notificationsService.getRules).mockReset();
    vi.mocked(notificationsService.updateRule).mockReset();
    vi.mocked(notificationsService.deleteRule).mockReset();
    vi.mocked(notificationsService.deleteRule).mockResolvedValue(undefined);
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
  });

  it('saves a rename and stores a cleared description as null', async () => {
    const user = userEvent.setup();
    vi.mocked(notificationsService.updateRule).mockResolvedValue(rule({ name: 'Drill reminders', description: null }));
    renderRules([rule()]);

    await user.click(await screen.findByRole('button', { name: 'Edit Event reminders' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Notification Rule' });
    const name = within(dialog).getByLabelText(/rule name/i);
    await user.clear(name);
    await user.type(name, 'Drill reminders');
    await user.clear(within(dialog).getByLabelText(/description/i));
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    expect(notificationsService.updateRule).toHaveBeenCalledWith('rule-1', {
      name: 'Drill reminders',
      trigger: 'event_reminder',
      description: null,
    });
    expect(await screen.findByText('Drill reminders')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps an unenforced trigger selected when the rule is opened', async () => {
    const user = userEvent.setup();
    renderRules([rule({ name: 'Maintenance due', trigger: 'maintenance_due', enforced: false })]);

    await user.click(await screen.findByRole('button', { name: 'Edit Maintenance due' }));

    expect(screen.getByLabelText(/trigger event/i)).toHaveValue('maintenance_due');
  });

  it('warns that moving the only switched-off rule turns its old trigger back on', async () => {
    const user = userEvent.setup();
    renderRules([rule({ enabled: false })]);

    await user.click(await screen.findByRole('button', { name: 'Edit Event reminders' }));
    await user.selectOptions(screen.getByLabelText(/trigger event/i), 'training_expiry');

    expect(screen.getByRole('status')).toHaveTextContent(
      /event reminder notifications go out again for the whole department/i
    );
  });

  it('warns that deleting the only switched-off rule turns its trigger back on', async () => {
    const user = userEvent.setup();
    renderRules([rule({ enabled: false })]);

    await user.click(await screen.findByRole('button', { name: 'Delete Event reminders' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this rule?' });
    expect(dialog).toHaveTextContent(/they go out again for the whole department/i);
    await user.click(within(dialog).getByRole('button', { name: 'Delete rule' }));

    expect(notificationsService.deleteRule).toHaveBeenCalledWith('rule-1');
    expect(screen.queryByText('Event reminders')).not.toBeInTheDocument();
  });

  it('warns that deleting the only switched-on rule among switched-off ones stops the trigger', async () => {
    const user = userEvent.setup();
    renderRules([rule(), rule({ id: 'rule-2', name: 'Old reminders', enabled: false })]);

    await user.click(await screen.findByRole('button', { name: 'Delete Event reminders' }));

    expect(await screen.findByRole('dialog', { name: 'Delete this rule?' })).toHaveTextContent(
      /event reminder notifications stop for the whole department/i
    );
  });

  it('says nothing changes when deleting leaves the trigger as it was', async () => {
    const user = userEvent.setup();
    renderRules([rule()]);

    await user.click(await screen.findByRole('button', { name: 'Delete Event reminders' }));

    expect(await screen.findByRole('dialog', { name: 'Delete this rule?' })).toHaveTextContent(/does not change/i);
  });

  it('deletes nothing when the confirmation is declined', async () => {
    const user = userEvent.setup();
    renderRules([rule({ enabled: false })]);

    await user.click(await screen.findByRole('button', { name: 'Delete Event reminders' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Delete this rule?' })).getByRole('button', { name: 'Keep it' })
    );

    expect(notificationsService.deleteRule).not.toHaveBeenCalled();
    expect(screen.getByText('Event reminders')).toBeInTheDocument();
  });
});
