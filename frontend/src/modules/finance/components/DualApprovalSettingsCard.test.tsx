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

  describe('per request type (owner decision 2026-11-01)', () => {
    const perType = {
      dualApprovalThreshold: '1000.00',
      dualApprovalThresholds: [
        { entityType: 'purchase_request', threshold: '1000.00', followsDefault: true },
        { entityType: 'check_request', threshold: '5000.00', followsDefault: false },
        { entityType: 'expense_report', threshold: null, followsDefault: false },
      ],
      secondApproverPosition: null,
      secondApproverPositionName: null,
    };

    beforeEach(() => {
      mockGetSettings.mockReset();
      mockGetSettings.mockResolvedValue(perType);
    });

    it('states each type as the server reads it', async () => {
      renderWithRouter(<DualApprovalSettingsCard />);
      expect(await screen.findByText('Purchase requests: $1,000.00 or more (same as above)')).toBeInTheDocument();
      expect(screen.getByText('Check requests: $5,000.00 or more')).toBeInTheDocument();
      expect(screen.getByText('Expense reports: Off')).toBeInTheDocument();
    });

    it('sends every type on save, null for "same as above" and 0 for off', async () => {
      const user = userEvent.setup();
      renderWithRouter(<DualApprovalSettingsCard />);
      const form = await screen.findByRole('form', { name: 'Thresholds by request type' });
      expect(within(form).getByLabelText('Check requests threshold (whole dollars)')).toHaveValue(5000);

      await user.selectOptions(within(form).getByLabelText('Purchase requests'), 'own');
      await user.type(within(form).getByLabelText('Purchase requests threshold (whole dollars)'), '2500');
      await user.selectOptions(within(form).getByLabelText('Check requests'), 'default');
      await user.click(within(form).getByRole('button', { name: 'Save request types' }));

      await waitFor(() =>
        expect(mockUpdateSettings).toHaveBeenCalledWith({
          finance: { dual_approval_thresholds: { purchase_request: 2500, check_request: null, expense_report: 0 } },
        })
      );
      expect(mockToastSuccess).toHaveBeenCalledWith('Request-type thresholds saved');
    });

    it('refuses a type with its own threshold but no amount', async () => {
      const user = userEvent.setup();
      renderWithRouter(<DualApprovalSettingsCard />);
      const form = await screen.findByRole('form', { name: 'Thresholds by request type' });

      await user.selectOptions(within(form).getByLabelText('Purchase requests'), 'own');
      await user.click(within(form).getByRole('button', { name: 'Save request types' }));

      expect(
        screen.getByText('Enter a whole-dollar amount of $1 or more for each type with its own threshold.')
      ).toBeInTheDocument();
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('is not editable without settings.manage', async () => {
      signIn(['finance.manage']);
      renderWithRouter(<DualApprovalSettingsCard />);
      expect(await screen.findByText('Check requests: $5,000.00 or more')).toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Thresholds by request type' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Second approval from')).not.toBeInTheDocument();
    });
  });

  describe('the office that gives the second approval (owner decision 2026-11-01)', () => {
    const positions = [
      { value: 'chief', label: 'Chief' },
      { value: 'treasurer', label: 'Treasurer' },
    ];

    beforeEach(() => {
      mockGetSettings.mockReset();
      mockGetSettings.mockResolvedValue({
        dualApprovalThreshold: '1000.00',
        secondApproverPosition: null,
        secondApproverPositionName: null,
      });
    });

    it('says anyone may give it when no office is named', async () => {
      renderWithRouter(<DualApprovalSettingsCard positions={positions} />);
      expect(
        await screen.findByText('Any finance approver other than the first may give the second approval.')
      ).toBeInTheDocument();
    });

    it('names the office and saves a choice', async () => {
      const user = userEvent.setup();
      renderWithRouter(<DualApprovalSettingsCard positions={positions} />);

      await user.selectOptions(await screen.findByLabelText('Second approval from'), 'treasurer');
      await user.click(screen.getByRole('button', { name: 'Save second approver' }));

      await waitFor(() =>
        expect(mockUpdateSettings).toHaveBeenCalledWith({ finance: { second_approver_position: 'treasurer' } })
      );
    });

    it('clears the office with an explicit null', async () => {
      mockGetSettings.mockResolvedValue({
        dualApprovalThreshold: '1000.00',
        secondApproverPosition: 'treasurer',
        secondApproverPositionName: 'Treasurer',
      });
      const user = userEvent.setup();
      renderWithRouter(<DualApprovalSettingsCard positions={positions} />);
      expect(await screen.findByText('One of the two approvers must hold the Treasurer position.')).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText('Second approval from'), '');
      await user.click(screen.getByRole('button', { name: 'Save second approver' }));

      await waitFor(() =>
        expect(mockUpdateSettings).toHaveBeenCalledWith({ finance: { second_approver_position: null } })
      );
    });

    it('warns when the named office no longer exists', async () => {
      mockGetSettings.mockResolvedValue({
        dualApprovalThreshold: '1000.00',
        secondApproverPosition: 'gone',
        secondApproverPositionName: null,
      });
      renderWithRouter(<DualApprovalSettingsCard positions={positions} />);
      expect(
        await screen.findByText(
          'The gone position no longer exists, so large requests cannot be completed until this is changed.'
        )
      ).toBeInTheDocument();
    });
  });
});
