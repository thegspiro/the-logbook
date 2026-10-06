/**
 * The panel holds the scheduling notification settings each sender reads.
 * Six preset switches used to sit above them, storing `schedule_change` rules
 * nothing consulted (W36-1, CLAUDE.md pitfall 19); they were removed, and
 * these cases keep them gone and keep the remaining settings saving.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
