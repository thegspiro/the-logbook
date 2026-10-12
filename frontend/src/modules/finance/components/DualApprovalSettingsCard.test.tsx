/**
 * The dual-approval threshold card on the approval chains page.
 *
 * It shows the server's reading of the rule, and only a settings
 * administrator may change it: the rule binds the finance officers, so they
 * read it but cannot lift it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
import { DualApprovalSettingsCard } from './DualApprovalSettingsCard';

const signIn = (permissions: string[]) => {
  useAuthStore.setState({ user: { id: 'u-1', permissions } as never });
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue({ dualApprovalThreshold: '1000.00' });
  mockUpdateSettings.mockReset();
  mockUpdateSettings.mockResolvedValue({});
  signIn(['settings.manage', 'finance.view']);
});

describe('DualApprovalSettingsCard', () => {
  it('states the rule the server applies', async () => {
    renderWithRouter(<DualApprovalSettingsCard />);
    expect(await screen.findByText('Requests of $1,000.00 or more need two different approvers.')).toBeInTheDocument();
  });

  it('says when it is off', async () => {
    mockGetSettings.mockResolvedValue({ dualApprovalThreshold: null });
    renderWithRouter(<DualApprovalSettingsCard />);
    expect(await screen.findByText('Off: one approval completes any request.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
  });

  it('lets a settings administrator change it, then re-reads it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DualApprovalSettingsCard />);
    const input = await screen.findByLabelText('Threshold (whole dollars)');
    expect(input).toHaveValue(1000);

    await user.clear(input);
    await user.type(input, '2500');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({ finance: { dual_approval_threshold: 2500 } })
    );
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalledTimes(2));
    expect(mockToastSuccess).toHaveBeenCalledWith('Dual-approval threshold saved');
  });

  it('refuses an amount that is not whole dollars without calling the API', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DualApprovalSettingsCard />);
    const input = await screen.findByLabelText('Threshold (whole dollars)');

    await user.clear(input);
    await user.type(input, '99.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Enter a whole-dollar amount of $1 or more.')).toBeInTheDocument();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('turns it off only after saying what that means', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DualApprovalSettingsCard />);
    await user.click(await screen.findByRole('button', { name: 'Turn off' }));

    const dialog = await screen.findByRole('dialog', { name: 'Turn off dual approval' });
    expect(mockUpdateSettings).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Turn it off' }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({ finance: { dual_approval_threshold: null } })
    );
  });

  it('is read-only for a finance officer without settings.manage', async () => {
    signIn(['finance.manage', 'finance.configure_approvals']);
    renderWithRouter(<DualApprovalSettingsCard />);

    expect(
      await screen.findByText(
        'Only a settings administrator can change this, because it applies to the finance officers themselves.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Threshold (whole dollars)')).not.toBeInTheDocument();
  });

  it('says so when the rule cannot be loaded', async () => {
    mockGetSettings.mockRejectedValue(new Error('down'));
    renderWithRouter(<DualApprovalSettingsCard />);
    expect(await screen.findByText(/down|Could not load the dual-approval rule/)).toBeInTheDocument();
  });
});
