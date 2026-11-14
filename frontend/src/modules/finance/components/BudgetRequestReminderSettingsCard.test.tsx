/**
 * The budget-request reminder schedule on Finance Settings (owner decision,
 * 2026-11-01: make it configurable). Shows the schedule the server's
 * reminder follows, and a finance manager sets the days and bell entries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../services/api', () => ({
  budgetRequestReminderService: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    update: (...args: unknown[]) => mockUpdate(...args) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import { renderWithRouter } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { BudgetRequestReminderSettingsCard } from './BudgetRequestReminderSettingsCard';
import { parseReminderDays } from '../utils/reminderDays';

const signIn = (permissions: string[]) => {
  useAuthStore.setState({ user: { id: 'u-1', permissions } as never });
};

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockResolvedValue({ offsetsDays: [7, 1], bellNotices: false, isDefault: true });
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue({ offsetsDays: [14, 3, 0], bellNotices: true, isDefault: false });
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  signIn(['finance.manage']);
});

describe('parseReminderDays', () => {
  it('reads a typed list, most distant first, without repeats', () => {
    expect(parseReminderDays(' 3, 14,3 , 0')).toEqual([14, 3, 0]);
    expect(parseReminderDays('')).toEqual([]);
  });

  it('refuses anything the backend would', () => {
    expect(parseReminderDays('61')).toMatch(/0 to 60/);
    expect(parseReminderDays('-1')).toMatch(/0 to 60/);
    expect(parseReminderDays('1.5')).toMatch(/0 to 60/);
    expect(parseReminderDays('1,2,3,4,5,6')).toMatch(/At most 5/);
  });
});

describe('BudgetRequestReminderSettingsCard', () => {
  it("states the schedule the server's reminder follows", async () => {
    renderWithRouter(<BudgetRequestReminderSettingsCard />);

    expect(
      await screen.findByText('Owners who still owe a request are reminded 7 days before, 1 day before, by email.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Days before the request deadline')).toHaveValue('7, 1');
    expect(screen.getByRole('checkbox', { name: /notification bell/i })).not.toBeChecked();
  });

  it('saves the days and the bell choice', async () => {
    const user = userEvent.setup();
    renderWithRouter(<BudgetRequestReminderSettingsCard />);

    const days = await screen.findByLabelText('Days before the request deadline');
    await user.clear(days);
    await user.type(days, '3, 14, 0');
    await user.click(screen.getByRole('checkbox', { name: /notification bell/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ offsetsDays: [14, 3, 0], bellNotices: true }));
    expect(mockToastSuccess).toHaveBeenCalledWith('Reminder schedule saved');
    expect(screen.getByText(/on the deadline day, by email and in the notification bell/)).toBeInTheDocument();
  });

  it('a blank list turns the reminder off', async () => {
    mockUpdate.mockResolvedValue({ offsetsDays: [], bellNotices: false, isDefault: false });
    const user = userEvent.setup();
    renderWithRouter(<BudgetRequestReminderSettingsCard />);

    await user.clear(await screen.findByLabelText('Days before the request deadline'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ offsetsDays: [], bellNotices: false }));
    expect(screen.getByText('No reminders are sent before the deadline.')).toBeInTheDocument();
  });

  it('says what is wrong instead of saving', async () => {
    const user = userEvent.setup();
    renderWithRouter(<BudgetRequestReminderSettingsCard />);

    const days = await screen.findByLabelText('Days before the request deadline');
    await user.clear(days);
    await user.type(days, '90');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/whole number of days from 0 to 60/)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a member without finance.manage reads it but cannot change it', async () => {
    signIn(['finance.view']);
    renderWithRouter(<BudgetRequestReminderSettingsCard />);

    expect(await screen.findByText(/reminded 7 days before/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
