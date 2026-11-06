/**
 * The pending-amendment queue (owner decision, 2026-11-01: "Email + pending
 * queue").
 *
 * Every amendment and reversal awaiting a second officer, across the
 * department's lines, in one place for whoever may confirm — a
 * `finance.budget_review` or `finance.manage` holder. Each row names its line
 * and year (a reviewer may not be able to open the line), and offers Confirm
 * and Reject there, with Confirm hidden on the viewer's own entry, where
 * Reject reads Withdraw. A locked year's row offers neither. The backend
 * decides; the page shows what it reports and sends what the officer chose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { PendingBudgetAmendment } from '../types';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let me = 'u-president';
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: me } }),
}));

const listPendingAmendments = vi.fn();
const confirmAmendment = vi.fn();
const rejectAmendment = vi.fn();
vi.mock('../services/api', () => ({
  budgetService: {
    listPendingAmendments: (...args: unknown[]) => listPendingAmendments(...args) as unknown,
    confirmAmendment: (...args: unknown[]) => confirmAmendment(...args) as unknown,
    rejectAmendment: (...args: unknown[]) => rejectAmendment(...args) as unknown,
  },
}));

import PendingAmendmentsPage from './PendingAmendmentsPage';

const pending = (overrides: Partial<PendingBudgetAmendment>): PendingBudgetAmendment => ({
  id: 'am-hose',
  organizationId: 'org',
  budgetId: 'b-gear',
  amount: '400.00',
  reason: 'New hose',
  approvedBy: 'Board vote 11/2',
  approvedOn: '2026-11-02',
  createdBy: 'u-treasurer',
  enteredByName: 'Pat Treasurer',
  createdAt: '2026-11-03T12:00:00Z',
  isReversal: false,
  status: 'pending',
  categoryName: 'Gear',
  stationName: 'Station 2',
  fiscalYearId: 'fy-2026',
  fiscalYearName: 'FY2026',
  yearLocked: false,
  ...overrides,
});

const rows: PendingBudgetAmendment[] = [
  pending({}),
  pending({
    id: 'rev-gloves',
    amount: '-2250.00',
    reason: 'Entered $2,500 for $250',
    approvedBy: 'Chief',
    isReversal: true,
    reversesAmendmentId: 'am-gloves',
    reversesAmendmentRef: 'am-gloves',
    reversedAmendmentAmount: '2500.00',
    reversedAmendmentApprovedOn: '2026-10-07',
    categoryName: 'Training',
    stationName: null,
  }),
  pending({ id: 'am-mine', reason: 'My own entry', createdBy: 'u-president', enteredByName: 'Sam President' }),
  pending({ id: 'am-locked', reason: 'Old year', fiscalYearName: 'FY2024', yearLocked: true }),
];

const renderPage = async () => {
  render(
    <MemoryRouter initialEntries={['/finance/budget-amendments']}>
      <ConfirmProvider>
        <PendingAmendmentsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );
  return screen.findByRole('list', { name: 'Pending amendments' });
};

const rowFor = (text: string): HTMLElement => {
  const list = screen.getByRole('list', { name: 'Pending amendments' });
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => li.textContent.includes(text));
  if (!item) throw new Error(`no row containing ${text}`);
  return item;
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [listPendingAmendments, confirmAmendment, rejectAmendment]) mock.mockReset();
  listPendingAmendments.mockResolvedValue(rows);
  confirmAmendment.mockResolvedValue({});
  rejectAmendment.mockResolvedValue({});
  me = 'u-president';
});

describe('Pending amendments queue', () => {
  it('lists each one with its line, year, amount and who entered it', async () => {
    await renderPage();
    const hose = within(rowFor('New hose'));
    expect(hose.getByRole('link', { name: 'Gear · Station 2' })).toHaveAttribute('href', '/finance/budgets/b-gear');
    expect(hose.getByText('FY2026')).toBeInTheDocument();
    expect(hose.getByText('+$400.00')).toBeInTheDocument();
    expect(hose.getByText(/Entered by Pat Treasurer/)).toBeInTheDocument();
    expect(hose.getByText('Approved 11/2/2026 by Board vote 11/2')).toBeInTheDocument();
  });

  it('says which amendment a reversal reverses', async () => {
    await renderPage();
    const reversal = within(rowFor('Entered $2,500 for $250'));
    expect(reversal.getByText(/^−\$2,250\.00/)).toBeInTheDocument();
    expect(reversal.getByText('· Reverses the 10/7/2026 amendment of +$2,500.00')).toBeInTheDocument();
  });

  it("hides Confirm on the viewer's own entry, where Reject reads Withdraw", async () => {
    await renderPage();
    const mine = within(rowFor('My own entry'));
    expect(mine.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
    expect(mine.getByRole('button', { name: /^Withdraw/ })).toBeInTheDocument();
    const theirs = within(rowFor('New hose'));
    expect(theirs.getByRole('button', { name: /^Confirm/ })).toBeInTheDocument();
    expect(theirs.getByRole('button', { name: /^Reject/ })).toBeInTheDocument();
  });

  it('offers nothing in a locked year, and says why', async () => {
    await renderPage();
    const locked = within(rowFor('Old year'));
    expect(locked.queryByRole('button')).not.toBeInTheDocument();
    expect(
      locked.getByText('FY2024 is locked; it cannot be confirmed or rejected until the year is unlocked.')
    ).toBeInTheDocument();
  });

  it('confirms through the confirmation dialog, then re-reads the queue', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(rowFor('New hose')).getByRole('button', { name: /^Confirm/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Confirm amendment' }));
    expect(dialog.getByText(/This raises the line's budget by \$400\.00/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Confirm amendment' }));
    await waitFor(() => expect(confirmAmendment).toHaveBeenCalledWith('b-gear', 'am-hose'));
    expect(toastSuccess).toHaveBeenCalledWith('Amendment confirmed');
    await waitFor(() => expect(listPendingAmendments).toHaveBeenCalledTimes(2));
  });

  it('rejects with the reason given', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(rowFor('New hose')).getByRole('button', { name: /^Reject/ }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText('Reason'), 'Not what the board approved');
    await user.click(dialog.getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(rejectAmendment).toHaveBeenCalledWith('b-gear', 'am-hose', { note: 'Not what the board approved' })
    );
    await waitFor(() => expect(listPendingAmendments).toHaveBeenCalledTimes(2));
  });

  it("shows the API's message when a confirmation is refused", async () => {
    confirmAmendment.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: { status: 409, data: { detail: 'Insufficient available budget' } },
    });
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(rowFor('New hose')).getByRole('button', { name: /^Confirm/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Confirm amendment' }));
    await user.click(dialog.getByRole('button', { name: 'Confirm amendment' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Insufficient available budget'));
  });

  it('says so when nothing is waiting', async () => {
    listPendingAmendments.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <PendingAmendmentsPage />
        </ConfirmProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText('No amendments are waiting for confirmation.')).toBeInTheDocument();
  });
});
