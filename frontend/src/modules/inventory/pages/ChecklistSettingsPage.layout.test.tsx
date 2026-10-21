/**
 * The phone layout of the checklist settings screen: switch rows that save on
 * the tap, hours fields that open the digit pad, and one route back instead of
 * a breadcrumb trail plus a Back link that repeated it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

import { ChecklistSettingsPage } from './ChecklistSettingsPage';

const SAVED = {
  start_of_shift_enabled: true,
  end_of_shift_enabled: false,
  checkin_opens_hours_before: 2,
  checkin_closes_hours_after: 12,
};

describe('checklist settings layout', () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    getSettings.mockResolvedValue({ shift_reports: { checklist_timing: { ...SAVED } } });
    updateSettings.mockResolvedValue({});
  });

  it('shows each prompt setting as a switch carrying its saved state and description', async () => {
    renderWithRouter(<ChecklistSettingsPage />);

    const start = await screen.findByRole('switch', { name: 'Start-of-shift checklists' });
    const end = screen.getByRole('switch', { name: 'End-of-shift checklists' });
    expect(start).toBeChecked();
    expect(end).not.toBeChecked();
    expect(start).toHaveAccessibleDescription(
      'Members are prompted to complete equipment checks when their shift begins.'
    );
  });

  it('saves the whole timing block the moment a switch is flipped', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ChecklistSettingsPage />);

    await user.click(await screen.findByRole('switch', { name: 'End-of-shift checklists' }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        shift_reports: { checklist_timing: { ...SAVED, end_of_shift_enabled: true } },
      })
    );
    expect(screen.getByRole('switch', { name: 'End-of-shift checklists' })).toBeChecked();
  });

  it('asks the phone for the digit pad on both hours fields', async () => {
    renderWithRouter(<ChecklistSettingsPage />);

    const opens = await screen.findByRole('textbox', { name: 'Opens before the start' });
    const closes = screen.getByRole('textbox', { name: 'Closes after the end' });
    expect(opens).toHaveAttribute('inputmode', 'numeric');
    expect(closes).toHaveAttribute('inputmode', 'numeric');
    expect(opens).toHaveValue('2');
    expect(opens).toHaveAccessibleDescription('hours early');
    expect(closes).toHaveAccessibleDescription('hours late');
  });

  it('groups the controls under their section headings', async () => {
    renderWithRouter(<ChecklistSettingsPage />);

    const prompted = await screen.findByRole('region', { name: 'When crews are prompted' });
    const checkin = screen.getByRole('region', { name: 'When members can check in' });
    expect(within(prompted).getAllByRole('switch')).toHaveLength(2);
    expect(within(checkin).getAllByRole('textbox')).toHaveLength(2);
  });

  it('no longer repeats the breadcrumb trail as a separate Back link', async () => {
    renderWithRouter(<ChecklistSettingsPage />);

    await screen.findByRole('heading', { name: 'Checklist Settings' });
    expect(screen.queryByRole('link', { name: /Back to Equipment Checklists/ })).not.toBeInTheDocument();
  });
});
