/**
 * The restricted-fund overspend rule on the approval chains page: shows the
 * server's reading, and only a settings administrator may change it.
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
import { FundOverspendSettingsCard } from './FundOverspendSettingsCard';

const signIn = (permissions: string[]) => {
  useAuthStore.setState({ user: { id: 'u-1', permissions } as never });
};

const rules = (fundOverspendMode: string) => ({
  dualApprovalThreshold: null,
  substantiationMode: 'off',
  substantiationDays: 60,
  fundOverspendMode,
});

beforeEach(() => {
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue(rules('warn'));
  mockUpdateSettings.mockReset();
  mockUpdateSettings.mockResolvedValue({});
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  signIn(['settings.manage', 'finance.view']);
});

describe('FundOverspendSettingsCard', () => {
  it('states the rule the server applies', async () => {
    mockGetSettings.mockResolvedValue(rules('block'));
    renderWithRouter(<FundOverspendSettingsCard />);

    expect(await screen.findByRole('radio', { name: 'Block' })).toBeChecked();
    expect(screen.getAllByText(/Block: it cannot be approved/)).not.toHaveLength(0);
  });

  it('saves only its own key through organization settings, then re-reads it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FundOverspendSettingsCard />);
    await user.click(await screen.findByRole('radio', { name: 'Off' }));
    mockGetSettings.mockResolvedValue(rules('off'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ finance: { fund_overspend_mode: 'off' } }));
    expect(mockToastSuccess).toHaveBeenCalledWith('Restricted fund rule saved');
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
  });

  it('shows the refusal when saving fails', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('Not allowed'));
    const user = userEvent.setup();
    renderWithRouter(<FundOverspendSettingsCard />);
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Not allowed'));
  });

  it('only describes the rule to someone who cannot change it', async () => {
    signIn(['finance.view']);
    renderWithRouter(<FundOverspendSettingsCard />);

    expect(await screen.findByText(/Only a settings administrator can change this/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
