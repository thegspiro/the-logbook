/**
 * The Rules tab tells the truth about what a rule does.
 *
 * Rules shipped with CRUD, this screen, and no dispatcher: a chief could
 * create "Event reminders", see it badged *Active*, toggle it off, and the
 * reminders kept going out. The backend now enforces the triggers that have a
 * sender and reports `enforced` on every rule; these cover the screen's half —
 * that it only offers triggers which work, and marks the rest.
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

/** Opens the create modal once the rules tab has finished loading. */
const openCreateModal = async (user: ReturnType<typeof userEvent.setup>) => {
  const buttons = await screen.findAllByRole('button', { name: /create rule/i });
  const trigger = buttons[0];
  if (!trigger) throw new Error('No Create Rule button rendered');
  await user.click(trigger);
};

describe('NotificationsPage rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notificationsService.getSummary).mockResolvedValue({
      total_rules: 1,
      active_rules: 1,
      emails_sent_this_month: 0,
      notifications_sent_this_month: 0,
    });
    vi.mocked(notificationsService.getLogs).mockResolvedValue({
      logs: [],
      total: 0,
      skip: 0,
      limit: 20,
    });
    vi.mocked(notificationsService.getMyNotifications).mockResolvedValue({ logs: [], total: 0 } as never);
  });

  it('does not mark a rule whose sender consults it', async () => {
    renderRules([rule()]);

    expect(await screen.findByText('Event reminders')).toBeInTheDocument();
    expect(screen.queryByText(/not enforced/i)).not.toBeInTheDocument();
  });

  it('marks a rule that nothing reads', async () => {
    // A rule created before the dropdown was narrowed. It stays listed — but
    // the Active badge beside it must not be the only thing the admin sees.
    renderRules([rule({ name: 'Maintenance due', trigger: 'maintenance_due', enforced: false })]);

    expect(await screen.findByText('Maintenance due')).toBeInTheDocument();
    expect(screen.getByText(/not enforced/i)).toBeInTheDocument();
  });

  it('offers only triggers that a sender actually consults', async () => {
    const user = userEvent.setup();
    renderRules([]);
    await openCreateModal(user);

    const options = await screen.findAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['event_reminder', 'training_expiry']);
  });

  it('describes what the rule will do instead of a channel it does not control', async () => {
    const user = userEvent.setup();
    renderRules([]);
    await openCreateModal(user);

    expect(await screen.findByText(/sends reminders before scheduled events/i)).toBeInTheDocument();
    // The old note promised "Channel defaults to In-App", which no sender read.
    expect(screen.queryByText(/channel defaults to/i)).not.toBeInTheDocument();
  });
});
