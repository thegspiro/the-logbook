import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { OverdueMember } from '../../types/user';
import { OverduePropertyReturnsPanel } from './OverduePropertyReturnsPanel';

const getOverduePropertyReturns = vi.fn<() => Promise<{ overdue_count: number; members: OverdueMember[] }>>();
const processPropertyReturnReminders =
  vi.fn<() => Promise<{ reminders_sent: number; dropped_members_checked: number }>>();

vi.mock('../../services/api', () => ({
  memberStatusService: {
    getOverduePropertyReturns: () => getOverduePropertyReturns(),
    processPropertyReturnReminders: () => processPropertyReturnReminders(),
  },
}));

const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => toastSuccess(...args) as unknown, error: vi.fn() },
}));

const former: OverdueMember = {
  user_id: 'u9',
  member_name: 'Casey Former',
  email: 'c.former@example.org',
  status: 'dropped_voluntary',
  dropped_date: '2026-08-01',
  days_since_drop: 65,
  items_outstanding: 2,
  total_value: 450,
  items: [],
  reminders_sent: ['30_day'],
};

describe('OverduePropertyReturnsPanel', () => {
  beforeEach(() => {
    getOverduePropertyReturns.mockReset();
    getOverduePropertyReturns.mockResolvedValue({ overdue_count: 1, members: [former] });
    processPropertyReturnReminders.mockReset();
    processPropertyReturnReminders.mockResolvedValue({ reminders_sent: 1, dropped_members_checked: 1 });
    toastSuccess.mockReset();
  });

  it('lists former members with property out, linked to their profile', async () => {
    renderWithRouter(<OverduePropertyReturnsPanel tz="UTC" />);

    const link = await screen.findByRole('link', { name: 'Casey Former' });
    expect(link).toHaveAttribute('href', '/members/u9');
    expect(screen.getByText(/2 items/)).toBeInTheDocument();
    expect(screen.getByText(/65 days ago/)).toBeInTheDocument();
  });

  it('says so when nobody is holding property', async () => {
    getOverduePropertyReturns.mockResolvedValue({ overdue_count: 0, members: [] });
    renderWithRouter(<OverduePropertyReturnsPanel tz="UTC" />);

    expect(await screen.findByText('No dropped member has property outstanding.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send due reminders/i })).not.toBeInTheDocument();
  });

  it('sends due reminders after confirmation, then reloads the list', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OverduePropertyReturnsPanel tz="UTC" />);

    await user.click(await screen.findByRole('button', { name: /send due reminders/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Send due reminders?' });
    await user.click(within(dialog).getByRole('button', { name: 'Send reminders' }));

    await waitFor(() => expect(processPropertyReturnReminders).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith('1 reminder sent');
    await waitFor(() => expect(getOverduePropertyReturns).toHaveBeenCalledTimes(2));
  });
});
