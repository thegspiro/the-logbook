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
const mockCheckPermission = vi.fn();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => mockCheckPermission(p) as boolean }),
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
  approverType: 'position',
  approverValue: 'treasurer',
  assigneeLabel: 'Treasurer position',
  canAct: true,
  requiresOverride: false,
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
  approverType: 'specific_user',
  approverValue: 'u-chief',
  assigneeLabel: 'Jordan Chief',
  canAct: true,
  requiresOverride: false,
};

// What an approvals admin sees for a step assigned to someone else.
const radioRepair: PendingApproval = {
  stepRecordId: 'sr-3',
  entityType: 'check_request',
  entityId: 'cr-4',
  entityTitle: 'Radio repair',
  entityAmount: '310.00',
  requesterName: 'Alex Kim',
  stepName: 'Trustee review',
  stepOrder: 1,
  submittedAt: '2026-09-22T15:00:00Z',
  approverType: 'position',
  approverValue: 'trustee',
  assigneeLabel: 'Trustee position',
  canAct: false,
  requiresOverride: true,
};

const rowFor = (title: string) => {
  const row = screen.getAllByRole('row').find((r) => within(r).queryByRole('link', { name: title }));
  expect(row).toBeDefined();
  return within(row as HTMLElement);
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
    mockCheckPermission.mockReset();
    mockCheckPermission.mockImplementation((p: string) => p === 'finance.approve');
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
    expect(cells.getByText('Treasurer position')).toBeInTheDocument();
    expect(cells.queryByText('Not assigned to you')).not.toBeInTheDocument();
    expect(cells.getByRole('button', { name: 'Approve New supply hose' })).toBeInTheDocument();
    expect(cells.getByRole('button', { name: 'Deny New supply hose' })).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    mockGetPending.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Nothing is waiting on you.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('does not claim nothing is waiting when the list failed to load', async () => {
    mockGetPending.mockRejectedValue({ response: { status: 500, data: { detail: 'Database unavailable' } } });
    renderPage();

    expect(await screen.findByText(/Database unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Nothing is waiting on you.')).not.toBeInTheDocument();
  });

  it('approves the row’s step with the notes typed, then refreshes the list', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve New supply hose' }));
    await user.type(within(dialog()).getByLabelText(/Notes/), 'Quote attached, within budget');
    mockGetPending.mockResolvedValue([mileageClaim]);
    await user.click(within(dialog()).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('sr-1', 'Quote attached, within budget', undefined));
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

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('sr-2', undefined, undefined));
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

    await waitFor(() => expect(mockDeny).toHaveBeenCalledWith('sr-1', 'Over this year’s equipment budget', undefined));
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

  it('shows a "Waiting on" column naming who each step is assigned to', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'New supply hose' });

    expect(screen.getByRole('columnheader', { name: 'Waiting on' })).toBeInTheDocument();
    expect(rowFor('Conference mileage').getByText('Jordan Chief')).toBeInTheDocument();
  });

  it('describes the list as the viewer’s own, without the old organization-wide claim', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'New supply hose' });

    expect(screen.getByText('Requests waiting on you.')).toBeInTheDocument();
    expect(screen.queryByText(/Anyone with finance approval permission/)).not.toBeInTheDocument();
    expect(screen.queryByText(/approvals administrator/)).not.toBeInTheDocument();
  });

  it('tells an approvals admin they also see steps assigned to others', async () => {
    mockCheckPermission.mockImplementation(
      (p: string) => p === 'finance.approve' || p === 'finance.configure_approvals'
    );
    renderPage();
    await screen.findByRole('link', { name: 'New supply hose' });

    expect(screen.getByText('Requests waiting on you.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'As an approvals administrator you also see steps assigned to other people. To approve or deny one of those, you must give a reason, which is recorded in the audit log.'
      )
    ).toBeInTheDocument();
  });

  it('marks a row that is not assigned to the viewer and offers only the admin actions', async () => {
    mockGetPending.mockResolvedValue([hosePurchase, radioRepair]);
    renderPage();
    await screen.findByRole('link', { name: 'Radio repair' });

    const cells = rowFor('Radio repair');
    expect(cells.getByText('Not assigned to you')).toBeInTheDocument();
    expect(cells.getByText('Trustee position')).toBeInTheDocument();
    expect(cells.getByRole('button', { name: 'Approve Radio repair as approvals admin' })).toBeInTheDocument();
    expect(cells.getByRole('button', { name: 'Deny Radio repair as approvals admin' })).toBeInTheDocument();
    expect(cells.queryByRole('button', { name: 'Approve Radio repair' })).not.toBeInTheDocument();
  });

  it('will not approve a row not assigned to the viewer without an override reason, then sends it', async () => {
    mockGetPending.mockResolvedValue([radioRepair]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve Radio repair as approvals admin' }));
    expect(within(dialog()).getByRole('heading', { name: 'Approve as approvals admin' })).toBeInTheDocument();
    expect(within(dialog()).getByText(/This step is assigned to/)).toHaveTextContent(
      'This step is assigned to Trustee position.'
    );

    await user.click(within(dialog()).getByRole('button', { name: 'Approve as approvals admin' }));
    expect(within(dialog()).getByText('Override reason is required.')).toBeInTheDocument();
    expect(mockApprove).not.toHaveBeenCalled();

    await user.type(within(dialog()).getByLabelText(/Override reason/), 'Trustees have not met this month');
    await user.click(within(dialog()).getByRole('button', { name: 'Approve as approvals admin' }));

    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith('sr-3', undefined, 'Trustees have not met this month')
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Approved');
  });

  it('needs both a denial reason and an override reason to deny a row not assigned to the viewer', async () => {
    mockGetPending.mockResolvedValue([radioRepair]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Deny Radio repair as approvals admin' }));
    await user.type(within(dialog()).getByLabelText(/Override reason/), 'Trustee position is vacant');
    await user.click(within(dialog()).getByRole('button', { name: 'Deny as approvals admin' }));
    expect(within(dialog()).getByText('Reason is required.')).toBeInTheDocument();
    expect(mockDeny).not.toHaveBeenCalled();

    await user.type(within(dialog()).getByLabelText(/^Reason/), 'Duplicate of CR-3');
    await user.click(within(dialog()).getByRole('button', { name: 'Deny as approvals admin' }));

    await waitFor(() =>
      expect(mockDeny).toHaveBeenCalledWith('sr-3', 'Duplicate of CR-3', 'Trustee position is vacant')
    );
  });

  it('refuses an override reason longer than 2000 characters', async () => {
    mockGetPending.mockResolvedValue([radioRepair]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve Radio repair as approvals admin' }));
    const field = within(dialog()).getByLabelText(/Override reason/);
    await user.click(field);
    await user.paste('x'.repeat(2001));
    await user.click(within(dialog()).getByRole('button', { name: 'Approve as approvals admin' }));

    expect(within(dialog()).getByText('Override reason must be 2,000 characters or fewer.')).toBeInTheDocument();
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('shows the API’s refusal when the step is assigned to someone else', async () => {
    const detail = 'This step is waiting on Treasurer position.';
    mockApprove.mockRejectedValue({ response: { status: 403, data: { detail } } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Approve New supply hose' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining(detail)));
    expect(dialog()).toBeInTheDocument();
  });
});
