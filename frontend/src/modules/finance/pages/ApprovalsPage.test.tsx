import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import type { PendingApproval } from '../types';

const mockGetPending = vi.fn();
const mockApprove = vi.fn();
const mockDeny = vi.fn();

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  approvalService: {
    getPending: (...args: unknown[]) => mockGetPending(...args) as unknown,
    approve: (...args: unknown[]) => mockApprove(...args) as unknown,
    deny: (...args: unknown[]) => mockDeny(...args) as unknown,
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

vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));

import { useFinanceStore } from '../store/financeStore';
import ApprovalsPage from './ApprovalsPage';

const hosePurchase: PendingApproval = {
  stepRecordId: 'sr-1',
  entityType: 'purchase_request',
  entityId: 'pr-1',
  entityTitle: 'New supply hose',
  entityAmount: '1250.50',
  requesterName: 'Jamie Rivera',
  stepName: 'Treasurer review',
  stepOrder: 1,
  submittedAt: '2026-09-20T15:00:00Z',
};

const mileageClaim: PendingApproval = {
  stepRecordId: 'sr-2',
  entityType: 'expense_report',
  entityId: 'er-9',
  entityTitle: 'Conference mileage',
  entityAmount: '88.00',
  requesterName: 'Sam Lee',
  stepName: 'Chief sign-off',
  stepOrder: 2,
  submittedAt: '2026-09-21T15:00:00Z',
};

const renderPage = () => {
  window.history.replaceState({}, '', '/finance/approvals');
  return renderWithRouter(<ApprovalsPage />);
};

const dialog = () => screen.getByRole('dialog');

describe('ApprovalsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Implementations are reset, not just calls: a one-shot rejection left
    // queued by one test must not answer the next (CLAUDE.md pitfall #28).
    mockGetPending.mockReset();
    mockApprove.mockReset();
    mockDeny.mockReset();
    mockGetPending.mockResolvedValue([hosePurchase, mileageClaim]);
    mockApprove.mockResolvedValue({ id: 'sr-1', status: 'approved' });
    mockDeny.mockResolvedValue({ id: 'sr-1', status: 'denied' });
    useFinanceStore.setState({ pendingApprovals: [], error: null, isLoading: false });
  });

  it('lists each pending step with a link to its request', async () => {
    renderPage();

    const link = await screen.findByRole('link', { name: 'New supply hose' });
    expect(link).toHaveAttribute('href', '/finance/purchase-requests/pr-1');
    expect(screen.getByRole('link', { name: 'Conference mileage' })).toHaveAttribute('href', '/finance/expenses/er-9');

    const row = screen.getAllByRole('row').find((r) => within(r).queryByRole('link', { name: 'New supply hose' }));
    expect(row).toBeDefined();
    const cells = within(row as HTMLElement);
    expect(cells.getByText('Purchase request')).toBeInTheDocument();
    expect(cells.getByText('Jamie Rivera')).toBeInTheDocument();
    expect(cells.getByText('$1,250.50')).toBeInTheDocument();
    expect(cells.getByText('Treasurer review')).toBeInTheDocument();
    expect(cells.getByRole('button', { name: 'Approve New supply hose' })).toBeInTheDocument();
    expect(cells.getByRole('button', { name: 'Deny New supply hose' })).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    mockGetPending.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Nothing waiting for approval')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('does not claim nothing is waiting when the list failed to load', async () => {
    mockGetPending.mockRejectedValue({ response: { status: 500, data: { detail: 'Database unavailable' } } });
    renderPage();

    expect(await screen.findByText(/Database unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Nothing waiting for approval')).not.toBeInTheDocument();
  });

  it('approves the row’s step with the notes typed, then refreshes the list', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve New supply hose' }));
    await user.type(within(dialog()).getByLabelText(/Notes/), 'Quote attached, within budget');
    mockGetPending.mockResolvedValue([mileageClaim]);
    await user.click(within(dialog()).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('sr-1', 'Quote attached, within budget'));
    expect(mockDeny).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith('Approved');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'New supply hose' })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('approves without notes when none are typed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve Conference mileage' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('sr-2', undefined));
  });

  it('will not deny without a reason', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Deny New supply hose' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }));

    expect(within(dialog()).getByText('Reason is required.')).toBeInTheDocument();
    expect(mockDeny).not.toHaveBeenCalled();

    await user.type(within(dialog()).getByLabelText(/Reason/), 'Over this year’s equipment budget');
    await user.click(within(dialog()).getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(mockDeny).toHaveBeenCalledWith('sr-1', 'Over this year’s equipment budget'));
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith('Denied');
  });

  it('shows the API’s reason when an approval is refused, and keeps the dialog open', async () => {
    const detail =
      'You cannot approve your own purchase request. Separation of duties requires a different person to approve it.';
    mockApprove.mockRejectedValue({ response: { status: 403, data: { detail } } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve New supply hose' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining(detail)));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
    // The refusal is reported by the dialog, not written into the page banner.
    expect(useFinanceStore.getState().error).toBeNull();
  });
});
