import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const authState = { checkPermission: (_p: string) => true };

vi.mock('../services/api', () => ({
  minutesService: { getReminderSettings: (...a: unknown[]) => mockGet(...a) as unknown },
}));
vi.mock('../../../services/api', () => ({
  organizationService: { updateSettings: (...a: unknown[]) => mockUpdate(...a) as unknown },
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ReminderSettingsDialog } from './ReminderSettingsDialog';

const defaults = {
  action_item_reminders: true,
  reminder_days_before_due: 3,
  overdue_repeat_days: 7,
  open_items_digest: true,
};

describe('ReminderSettingsDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockGet.mockResolvedValue(defaults);
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    authState.checkPermission = () => true;
  });

  const open = () => render(<ReminderSettingsDialog isOpen onClose={onClose} />);

  it('shows what the server will apply, not a local default', async () => {
    mockGet.mockResolvedValue({ ...defaults, reminder_days_before_due: 5, overdue_repeat_days: 14 });
    open();

    expect(await screen.findByLabelText('First reminder, days before the due date')).toHaveValue(5);
    expect(screen.getByLabelText('Repeat while overdue, every this many days')).toHaveValue(14);
  });

  it('saves every field and then re-reads what the server holds', async () => {
    const user = userEvent.setup();
    open();

    const days = await screen.findByLabelText('First reminder, days before the due date');
    await user.clear(days);
    await user.type(days, '0');
    await user.click(screen.getByRole('checkbox', { name: /Weekly list of open items/ }));
    mockGet.mockResolvedValue({ ...defaults, reminder_days_before_due: 0, open_items_digest: false });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      minutes: {
        action_item_reminders: true,
        reminder_days_before_due: 0,
        overdue_repeat_days: 7,
        open_items_digest: false,
      },
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('explains what each number means as it is typed', async () => {
    const user = userEvent.setup();
    open();

    const days = await screen.findByLabelText('First reminder, days before the due date');
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

    const days = await screen.findByLabelText('First reminder, days before the due date');
    await user.clear(days);
    await user.type(days, '31');

    expect(screen.getByText('Enter a whole number from 0 to 30.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('will not save an empty field', async () => {
    const user = userEvent.setup();
    open();

    await user.clear(await screen.findByLabelText('Repeat while overdue, every this many days'));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is read-only for someone who cannot change organization settings', async () => {
    authState.checkPermission = (p: string) => p === 'minutes.manage';
    open();

    expect(await screen.findByLabelText('First reminder, days before the due date')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Email reminders to assignees/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText(/changed by a settings administrator/)).toBeInTheDocument();
  });

  it('turns the number fields off with the reminders switch', async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('checkbox', { name: /Email reminders to assignees/ }));

    expect(screen.getByLabelText('First reminder, days before the due date')).toBeDisabled();
    expect(screen.getByLabelText('Repeat while overdue, every this many days')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Weekly list of open items/ })).toBeEnabled();
  });

  it('shows the reason when the settings cannot be loaded', async () => {
    mockGet.mockRejectedValue(new Error('Forbidden'));
    open();

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the dialog open when saving fails', async () => {
    mockUpdate.mockRejectedValue(new Error('Nope'));
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
