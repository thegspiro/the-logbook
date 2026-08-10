/**
 * The toggles in this panel used to fail into `console.warn`. Because the
 * switch only moves when `setRules` runs, a failed save looked exactly like a
 * dead control: the officer clicks, the switch snaps back, and nothing says
 * why. These cover the two write paths reaching the user on failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetRules = vi.fn();
const mockToggleRule = vi.fn();
const mockCreateRule = vi.fn();
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  notificationsService: {
    getRules: (...a: unknown[]) => mockGetRules(...a) as unknown,
    toggleRule: (...a: unknown[]) => mockToggleRule(...a) as unknown,
    createRule: (...a: unknown[]) => mockCreateRule(...a) as unknown,
  },
  organizationService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockUpdateSettings(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) as unknown },
}));

// Imported after the mocks so the panel picks them up.
import { SchedulingNotificationsPanel } from './SchedulingNotificationsPanel';

const existingRule = {
  id: 'rule-1',
  name: 'New Assignment',
  description: 'Notify members when they are assigned to a shift',
  trigger: 'schedule_change',
  category: 'scheduling',
  channel: 'in_app',
  enabled: true,
  config: { event: 'assignment_created' },
};

describe('SchedulingNotificationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRules.mockResolvedValue({ rules: [existingRule] });
    mockGetSettings.mockResolvedValue({});
  });

  it('tells the officer when toggling a rule off fails', async () => {
    const user = userEvent.setup();
    mockToggleRule.mockRejectedValue(new Error('Service unavailable'));
    render(<SchedulingNotificationsPanel />);

    const toggle = await screen.findByRole('switch', { name: 'New Assignment' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Service unavailable'));
    // The switch reverts, which is why the message is the only thing
    // distinguishing a failure from a control that does nothing.
    expect(await screen.findByRole('switch', { name: 'New Assignment' })).toHaveAttribute('aria-checked', 'true');
  });

  it('tells the officer when turning on a new rule fails', async () => {
    const user = userEvent.setup();
    mockGetRules.mockResolvedValue({ rules: [] });
    mockCreateRule.mockRejectedValue(new Error('Service unavailable'));
    render(<SchedulingNotificationsPanel />);

    await user.click(await screen.findByRole('switch', { name: 'Swap Request' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Service unavailable'));
  });

  it('hides the switches when the rules could not be loaded', async () => {
    // Left rendering, every switch would read as off and clicking one would
    // post a duplicate rule rather than flipping the one that already exists.
    mockGetRules.mockRejectedValue(new Error('Service unavailable'));
    render(<SchedulingNotificationsPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByRole('switch', { name: 'New Assignment' })).not.toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith('Service unavailable');
  });

  it('leaves the switch on after a successful toggle', async () => {
    const user = userEvent.setup();
    mockToggleRule.mockResolvedValue({ ...existingRule, enabled: false });
    render(<SchedulingNotificationsPanel />);

    await user.click(await screen.findByRole('switch', { name: 'New Assignment' }));

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'New Assignment' })).toHaveAttribute('aria-checked', 'false')
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
