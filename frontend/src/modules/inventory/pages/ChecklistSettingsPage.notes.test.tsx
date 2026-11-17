/**
 * What happened to a change is said on the control that made it (forms review
 * batch 22): a refused save, an entry that could not be used, and a number
 * folded back into range used to be a vanishing toast, or nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  getSettings.mockReset();
  updateSettings.mockReset();
  getSettings.mockResolvedValue({
    shift_reports: {
      checklist_timing: {
        start_of_shift_enabled: true,
        end_of_shift_enabled: true,
        checkin_opens_hours_before: 2,
        checkin_closes_hours_after: 12,
      },
    },
  });
  updateSettings.mockResolvedValue({});
});

describe('ChecklistSettingsPage — notes on the control', () => {
  it('says why a box left empty snapped back', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ChecklistSettingsPage />);
    const opens = await screen.findByLabelText(/Opens before the start/i);

    await user.clear(opens);
    await user.tab();

    expect(opens).toHaveValue('2');
    expect(opens).toHaveAccessibleDescription(/Enter whole hours, from 0 to 24\. 2 is kept\./);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('says a number past the maximum was saved as the maximum', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ChecklistSettingsPage />);
    const opens = await screen.findByLabelText(/Opens before the start/i);

    await user.clear(opens);
    await user.type(opens, '999');
    await user.tab();

    await waitFor(() => expect(opens).toHaveAccessibleDescription(/24 is the most allowed\. 24 was saved\./));
  });

  it("says a refused switch save on that switch's row", async () => {
    updateSettings.mockRejectedValueOnce({
      response: { status: 403, data: { detail: 'You cannot change settings.' } },
    });
    const user = userEvent.setup();
    renderWithRouter(<ChecklistSettingsPage />);
    const toggle = await screen.findByRole('switch', { name: /Start-of-shift checklists/i });

    await user.click(toggle);

    await waitFor(() => expect(toggle).toHaveAccessibleDescription(/You cannot change settings\./));
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
