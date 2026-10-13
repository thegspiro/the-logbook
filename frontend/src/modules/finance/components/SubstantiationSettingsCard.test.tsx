/**
 * The expense deadline card on the approval chains page.
 *
 * It shows the server's reading of the rule, and only a settings
 * administrator may change it, within the IRS's 60-day safe harbor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
vi.mock('../services/api', () => ({
  financeSettingsService: { get: (...args: unknown[]) => mockGetSettings(...args) as unknown },
}));

const mockUpdateSettings = vi.fn();
vi.mock('@/services/api', () => ({
  organizationService: { updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) as unknown },
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
import { SubstantiationSettingsCard } from './SubstantiationSettingsCard';

const signIn = (permissions: string[]) => {
  useAuthStore.setState({ user: { id: 'u-1', permissions } as never });
};

const rules = (substantiationMode: string, substantiationDays = 60) => ({
  dualApprovalThreshold: null,
  substantiationMode,
  substantiationDays,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue(rules('off'));
  mockUpdateSettings.mockReset();
  mockUpdateSettings.mockResolvedValue({});
  signIn(['settings.manage', 'finance.view']);
});

describe('SubstantiationSettingsCard', () => {
  it('states the rule the server applies', async () => {
    mockGetSettings.mockResolvedValue(rules('warn', 45));
    renderWithRouter(<SubstantiationSettingsCard />);

    expect(await screen.findByText('Warn: expenses must be claimed within 45 days.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Warn' })).toBeChecked();
    expect(screen.getByLabelText('Days allowed')).toHaveValue(45);
  });

  it('saves the mode and days through organization settings, then re-reads them', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubstantiationSettingsCard />);
    await screen.findByText('Off: expenses are accepted however old they are.', { selector: 'p.mt-2' });

    await user.click(screen.getByRole('radio', { name: 'Block' }));
    const days = screen.getByLabelText('Days allowed');
    await user.clear(days);
    await user.type(days, '30');
    mockGetSettings.mockResolvedValue(rules('block', 30));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        finance: { substantiation_mode: 'block', substantiation_days: 30 },
      })
    );
    expect(await screen.findByText('Block: expenses must be claimed within 30 days.')).toBeInTheDocument();
    expect(mockToastSuccess).toHaveBeenCalledWith('Expense deadline saved');
  });

  it('refuses more than the 60-day safe harbor without asking the server', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubstantiationSettingsCard />);
    const days = await screen.findByLabelText('Days allowed');

    await user.clear(days);
    await user.type(days, '90');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Enter a whole number of days from 1 to 60.')).toBeInTheDocument();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('only shows the rule to a finance officer without settings.manage', async () => {
    signIn(['finance.view', 'finance.configure_approvals']);
    renderWithRouter(<SubstantiationSettingsCard />);

    expect(
      await screen.findByText(
        'Only a settings administrator can change this, because it applies to the finance officers themselves.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
