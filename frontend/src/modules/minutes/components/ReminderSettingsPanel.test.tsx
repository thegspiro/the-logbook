import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: { updateSettings: (...a: unknown[]) => mockUpdate(...a) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ReminderSettingsPanel } from './ReminderSettingsPanel';
import type { MinutesReminderSettings } from '../types/minutes';

const defaults: MinutesReminderSettings = {
  action_item_reminders: true,
  reminder_days_before_due: 3,
  overdue_repeat_days: 7,
  open_items_digest: true,
  signature_slots: [],
  public_posting: false,
  executive_library_publishing: false,
  executive_public_posting: false,
  executive_effective_library: false,
  executive_effective_public: false,
  attendance_listing: 'all',
  auto_file_election_results: true,
};

describe('ReminderSettingsPanel', () => {
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    onSaved.mockReset();
    onSaved.mockResolvedValue(undefined);
  });

  const open = (settings: MinutesReminderSettings = defaults, canEdit = true) =>
    render(<ReminderSettingsPanel settings={settings} canEdit={canEdit} onSaved={onSaved} />);

  it('shows what the server will apply, not a local default', () => {
    open({ ...defaults, reminder_days_before_due: 5, overdue_repeat_days: 14 });

    expect(screen.getByLabelText('First reminder, days before the due date')).toHaveValue(5);
    expect(screen.getByLabelText('Repeat while overdue, every this many days')).toHaveValue(14);
  });

  it('saves every field and then asks the page to re-read what the server holds', async () => {
    const user = userEvent.setup();
    open();

    const days = screen.getByLabelText('First reminder, days before the due date');
    await user.clear(days);
    await user.type(days, '0');
    await user.click(screen.getByRole('checkbox', { name: /Weekly list of open items/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      minutes: {
        action_item_reminders: true,
        reminder_days_before_due: 0,
        overdue_repeat_days: 7,
        open_items_digest: false,
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('has nothing to save until something changes', () => {
    open();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('follows the settings when the page reloads them', () => {
    const { rerender } = open();

    rerender(
      <ReminderSettingsPanel settings={{ ...defaults, reminder_days_before_due: 9 }} canEdit onSaved={onSaved} />
    );

    expect(screen.getByLabelText('First reminder, days before the due date')).toHaveValue(9);
  });

  it('explains what each number means as it is typed', async () => {
    const user = userEvent.setup();
    open();

    const days = screen.getByLabelText('First reminder, days before the due date');
    expect(screen.getByText('3 days ahead.')).toBeInTheDocument();
    await user.clear(days);
    await user.type(days, '0');
    expect(screen.getByText('On the day it is due, and not before.')).toBeInTheDocument();

    const repeat = screen.getByLabelText('Repeat while overdue, every this many days');
    await user.clear(repeat);
    await user.type(repeat, '0');
    expect(screen.getByText(/One overdue reminder, the day after it falls due, and no more/)).toBeInTheDocument();
  });

  it('will not save a number outside the range, and says what is allowed', async () => {
    const user = userEvent.setup();
    open();

    const days = screen.getByLabelText('First reminder, days before the due date');
    await user.clear(days);
    await user.type(days, '31');

    expect(screen.getByText('Enter a whole number from 0 to 30.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('will not save an empty field', async () => {
    const user = userEvent.setup();
    open();

    await user.clear(screen.getByLabelText('Repeat while overdue, every this many days'));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is read-only for someone who cannot change organization settings', () => {
    open(defaults, false);

    expect(screen.getByLabelText('First reminder, days before the due date')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Email reminders to assignees/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText(/changed by a settings administrator/)).toBeInTheDocument();
  });

  it('turns the number fields off with the reminders switch', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('checkbox', { name: /Email reminders to assignees/ }));

    expect(screen.getByLabelText('First reminder, days before the due date')).toBeDisabled();
    expect(screen.getByLabelText('Repeat while overdue, every this many days')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Weekly list of open items/ })).toBeEnabled();
  });

  it('does not report a save that failed', async () => {
    mockUpdate.mockRejectedValue(new Error('Nope'));
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('checkbox', { name: /Weekly list of open items/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
