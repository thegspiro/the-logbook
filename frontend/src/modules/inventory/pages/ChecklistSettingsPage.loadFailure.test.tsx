/**
 * EC2-11: a failed settings read left the defaults on screen, and every save
 * sends the whole checklist_timing block — so toggling one switch after a
 * failed read wrote the defaults over all four of the department's real
 * values. The screen now says the settings could not be read and offers
 * nothing to change until they load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const getSettings = vi.fn();
const updateSettings = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => getSettings(...args) as unknown,
    updateSettings: (...args: unknown[]) => updateSettings(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ChecklistSettingsPage } from './ChecklistSettingsPage';

const stored = {
  shift_reports: {
    checklist_timing: {
      start_of_shift_enabled: false,
      end_of_shift_enabled: true,
      checkin_opens_hours_before: 4,
      checkin_closes_hours_after: 6,
    },
  },
};

describe('ChecklistSettingsPage when the settings cannot be read', () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    updateSettings.mockResolvedValue({});
  });

  it('offers no switch that would save the defaults', async () => {
    getSettings.mockRejectedValue(new Error('Network Error'));
    renderWithRouter(<ChecklistSettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Opens before the start/i)).not.toBeInTheDocument();
  });

  it('loads them on a retry', async () => {
    getSettings.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(stored);
    const user = userEvent.setup();
    renderWithRouter(<ChecklistSettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText(/Opens before the start/i)).toHaveValue('4');
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
