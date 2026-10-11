/**
 * The panel holds the scheduling notification settings each sender reads.
 * Six preset switches used to sit above them, storing `schedule_change` rules
 * nothing consulted (W36-1, CLAUDE.md pitfall 19); they were removed, and
 * these cases keep them gone and keep the remaining settings saving.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
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

describe('SchedulingNotificationsPanel', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue({});
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockResolvedValue({});
    mockToastError.mockReset();
  });

  it('offers no switch for a notice it cannot silence', async () => {
    render(<SchedulingNotificationsPanel />);

    expect(await screen.findByText('Enable decline/drop notifications')).toBeInTheDocument();
    for (const name of [
      'New Assignment',
      'Assignment Confirmed',
      'Assignment Declined',
      'Time-Off Approved',
      'Swap Request',
      'Understaffed Shift',
    ]) {
      expect(screen.queryByRole('switch', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Not in effect yet/)).not.toBeInTheDocument();
  });

  it('saves the decline alert switch to the organization settings', async () => {
    const user = userEvent.setup();
    render(<SchedulingNotificationsPanel />);

    const checkbox = await screen.findByRole('checkbox', { name: 'Enable decline/drop notifications' });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        scheduling: expect.objectContaining({ notify_on_decline: false }) as unknown,
      })
    );
  });

  it('tells the officer when a save fails', async () => {
    const user = userEvent.setup();
    mockUpdateSettings.mockRejectedValue(new Error('Service unavailable'));
    render(<SchedulingNotificationsPanel />);

    await user.click(await screen.findByRole('checkbox', { name: 'Enable decline/drop notifications' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Service unavailable'));
  });
});

describe('SchedulingNotificationsPanel — start-of-shift reminder email default', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockResolvedValue({});
  });

  const reminderEmailBox = async () => {
    const section = await screen.findByRole('region', { name: 'Start-of-Shift Reminders' });
    return within(section).getByRole('checkbox', { name: 'Also send email notification' });
  };

  // The reminder sender emails unless send_email is explicitly false, so a
  // department that never saved this panel must see the box ticked.
  it('shows reminder emails as on when the department never saved the panel', async () => {
    mockGetSettings.mockResolvedValue({});
    render(<SchedulingNotificationsPanel />);

    expect(await reminderEmailBox()).toBeChecked();
  });

  it('shows reminder emails as off once the department turned them off', async () => {
    mockGetSettings.mockResolvedValue({ shift_reminders: { enabled: true, send_email: false } });
    render(<SchedulingNotificationsPanel />);

    await waitFor(async () => expect(await reminderEmailBox()).not.toBeChecked());
  });
});
