/**
 * The cash advance deadline method on the approval chains page (owner
 * decision 2026-11-01): shows the server's reading, defaults to the fixed
 * date, and only a settings administrator may change it.
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
import { AdvanceReturnMethodSettingsCard } from './AdvanceReturnMethodSettingsCard';

const signIn = (permissions: string[]) => {
  useAuthStore.setState({ user: { id: 'u-1', permissions } as never });
};

const rules = (advanceReturnMethod?: string) => ({
  dualApprovalThreshold: null,
  substantiationMode: 'off',
  substantiationDays: 60,
  fundOverspendMode: 'warn',
  ...(advanceReturnMethod ? { advanceReturnMethod } : {}),
});

beforeEach(() => {
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue(rules('fixed_date'));
  mockUpdateSettings.mockReset();
  mockUpdateSettings.mockResolvedValue({});
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  signIn(['settings.manage', 'finance.view']);
});

describe('AdvanceReturnMethodSettingsCard', () => {
  it('states the method the server applies', async () => {
    mockGetSettings.mockResolvedValue(rules('periodic_statement'));
    renderWithRouter(<AdvanceReturnMethodSettingsCard />);

    expect(await screen.findByRole('radio', { name: 'Quarterly statements' })).toBeChecked();
    expect(screen.getAllByText(/emailed what is still outstanding/)).not.toHaveLength(0);
  });

  it('reads an older server with no method as the fixed date', async () => {
    mockGetSettings.mockResolvedValue(rules());
    renderWithRouter(<AdvanceReturnMethodSettingsCard />);

    expect(await screen.findByRole('radio', { name: 'Fixed date' })).toBeChecked();
  });

  it('saves only its own key through organization settings, then re-reads it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AdvanceReturnMethodSettingsCard />);
    await user.click(await screen.findByRole('radio', { name: 'Quarterly statements' }));
    mockGetSettings.mockResolvedValue(rules('periodic_statement'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({ finance: { advance_return_method: 'periodic_statement' } })
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Cash advance deadline saved');
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
  });

  it('shows the refusal when saving fails', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('Not allowed'));
    const user = userEvent.setup();
    renderWithRouter(<AdvanceReturnMethodSettingsCard />);
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Not allowed'));
  });

  it('only describes the method to someone who cannot change it', async () => {
    signIn(['finance.view']);
    renderWithRouter(<AdvanceReturnMethodSettingsCard />);

    expect(await screen.findByText(/Only a settings administrator can change this/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
