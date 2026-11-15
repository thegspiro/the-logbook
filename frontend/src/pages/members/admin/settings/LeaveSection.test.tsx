/**
 * The Leave of Absence settings: the ending reminder and member requests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getSettings = vi.fn();
const updateSettings = vi.fn();

vi.mock('../../../../services/leaveRequestService', () => ({
  leaveRequestService: {
    getSettings: (...args: unknown[]) => getSettings(...args) as unknown,
    updateSettings: (...args: unknown[]) => updateSettings(...args) as unknown,
  },
}));

import LeaveSection from './LeaveSection';

const stored = {
  end_reminder_days: 7,
  end_reminder_copy_officers: true,
  requests_enabled: false,
  request_approver_position_ids: ['pos-board'],
  request_decision_rule: 'any',
  available_positions: [
    { id: 'pos-board', name: 'Board of Directors', holder_count: 0 },
    { id: 'pos-chief', name: 'Fire Chief', holder_count: 1 },
  ],
};

// The page's autosave runs the saver straight away here.
const save = vi.fn((saver: () => Promise<unknown>) => void saver());
const saveDebounced = vi.fn((_key: string, saver: () => Promise<unknown>) => void saver());

describe('LeaveSection', () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
    save.mockClear();
    saveDebounced.mockClear();
    getSettings.mockResolvedValue(structuredClone(stored));
    updateSettings.mockResolvedValue({});
  });

  it('turning requests on saves the whole setting and shows who decides', async () => {
    const user = userEvent.setup();
    render(<LeaveSection save={save} saveDebounced={saveDebounced} />);

    await user.click(await screen.findByRole('switch', { name: 'Members may ask for leave' }));

    expect(updateSettings).toHaveBeenCalledWith({
      end_reminder_days: 7,
      end_reminder_copy_officers: true,
      requests_enabled: true,
      request_approver_position_ids: ['pos-board'],
      request_decision_rule: 'any',
    });
    expect(screen.getByRole('checkbox', { name: /Board of Directors/ })).toBeChecked();
    // The chosen position is vacant, and the screen says where requests go.
    expect(screen.getByRole('status')).toHaveTextContent('Nobody holds Board of Directors');
  });

  it('choosing a rule saves it', async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue({ ...structuredClone(stored), requests_enabled: true });
    render(<LeaveSection save={save} saveDebounced={saveDebounced} />);

    await user.click(await screen.findByRole('radio', { name: /A majority of approvers/ }));

    expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ request_decision_rule: 'majority' }));
  });

  it('the reminder days save through the debounced autosave', async () => {
    const user = userEvent.setup();
    render(<LeaveSection save={save} saveDebounced={saveDebounced} />);

    const days = await screen.findByLabelText('Remind the member this many days ahead');
    await user.clear(days);
    await user.type(days, '14');

    expect(saveDebounced).toHaveBeenCalled();
    expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ end_reminder_days: 14 }));
  });

  it('a failed load says so rather than showing defaults', async () => {
    getSettings.mockRejectedValue(new Error('offline'));
    render(<LeaveSection save={save} saveDebounced={saveDebounced} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('did not load');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
