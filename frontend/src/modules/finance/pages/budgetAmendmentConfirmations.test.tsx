/**
 * Second-officer confirmation of budget amendments.
 *
 * An amendment (or a reversal) is entered pending and moves nothing until a
 * `finance.budget_review` or `finance.manage` holder other than whoever entered
 * it confirms it. The detail page offers Confirm and Reject to those holders,
 * hides Confirm on the viewer's own entry (where Reject reads "Withdraw"),
 * offers Reverse only on a confirmed amendment, and says when figures exclude
 * a pending one. The backend enforces every rule; these tests cover what the
 * page offers and what it sends.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { Budget, BudgetAmendment, FiscalYear } from '../types';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
let me = 'u-president';
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p), user: { id: me } }),
}));

const getBudget = vi.fn();
const listAmendments = vi.fn();
const confirmAmendment = vi.fn();
const rejectAmendment = vi.fn();
vi.mock('../services/api', () => ({
  budgetService: {
    get: (...args: unknown[]) => getBudget(...args) as unknown,
    listTransactions: () => Promise.resolve({ items: [], total: 0, limit: 25, offset: 0 }),
    listAmendments: (...args: unknown[]) => listAmendments(...args) as unknown,
    confirmAmendment: (...args: unknown[]) => confirmAmendment(...args) as unknown,
    rejectAmendment: (...args: unknown[]) => rejectAmendment(...args) as unknown,
  },
  financeOptionService: {
    positions: () => Promise.resolve([]),
    stations: () => Promise.resolve([]),
  },
}));

import BudgetDetailPage from './BudgetDetailPage';

const year = (id: string, locked: boolean): FiscalYear => ({
  id,
  organizationId: 'org',
  name: id,
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  status: locked ? 'closed' : 'active',
  isLocked: locked,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const line = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'b-open',
  organizationId: 'org',
  fiscalYearId: 'fy-open',
  categoryId: 'cat-gear',
  categoryName: 'Gear',
  amountBudgeted: '800.00',
  amountSpent: '100.00',
  amountEncumbered: '0.00',
  originalAmount: '800.00',
  amendmentsTotal: '0.00',
  amendmentCount: 0,
  pendingAmendmentCount: 1,
  amountEditable: false,
  createdBy: 'u-treasurer',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const amendment = (overrides: Partial<BudgetAmendment>): BudgetAmendment => ({
  id: 'am-x',
  organizationId: 'org',
  budgetId: 'b-open',
  amount: '250.00',
  reason: 'Hose',
  approvedBy: 'Board vote 9/30',
  approvedOn: '2026-09-30',
  createdBy: 'u-treasurer',
  enteredByName: 'Pat Treasurer',
  createdAt: '2026-10-01T12:00:00Z',
  isReversal: false,
  reversesAmendmentId: null,
  reversedByAmendmentId: null,
  reversedAt: null,
  reversedByName: null,
  status: 'confirmed',
  decidedBy: 'u-president',
  decidedByName: 'Robin President',
  decidedAt: '2026-10-02T12:00:00Z',
  decisionNote: null,
  ...overrides,
});

const pending = amendment({
  id: 'am-pending',
  amount: '400.00',
  reason: 'Nozzles',
  approvedBy: 'Board vote 10/7',
  approvedOn: '2026-10-07',
  status: 'pending',
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
});

const rejected = amendment({
  id: 'am-rejected',
  amount: '90.00',
  reason: 'Boots',
  status: 'rejected',
  decisionNote: 'No vote recorded',
});

const confirmed = amendment({ id: 'am-confirmed' });

const openLine = async () => {
  render(
    <MemoryRouter initialEntries={['/finance/budgets/b-open']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/finance/budgets/:id" element={<BudgetDetailPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Gear' });
  return screen.findByRole('list', { name: 'Amendments' });
};

const itemFor = (text: string): HTMLElement => {
  const list = screen.getByRole('list', { name: 'Amendments' });
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => li.textContent.includes(text));
  if (!item) throw new Error(`no amendment row containing ${text}`);
  return item;
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [getBudget, listAmendments, confirmAmendment, rejectAmendment]) mock.mockReset();
  getBudget.mockResolvedValue(line());
  listAmendments.mockResolvedValue([pending, rejected, confirmed]);
  confirmAmendment.mockResolvedValue({ amendment: { ...pending, status: 'confirmed' }, budget: line() });
  rejectAmendment.mockResolvedValue({ amendment: { ...pending, status: 'rejected' }, budget: line() });
  granted = new Set(['finance.view', 'finance.budget_review']);
  me = 'u-president';
  storeState = {
    fiscalYears: [year('fy-open', false)],
    budgetCategories: [],
    isLoading: false,
    error: null,
    fetchFiscalYears: vi.fn(),
    fetchBudgetCategories: vi.fn(),
  };
});

describe('what the list shows', () => {
  it('marks a pending amendment and says the figures do not include it yet', async () => {
    await openLine();
    expect(within(itemFor('Nozzles')).getByText('Pending confirmation')).toBeInTheDocument();
    expect(
      screen.getByText('1 amendment is awaiting confirmation by a second officer and is not yet in these figures.')
    ).toBeInTheDocument();
  });

  it('strikes through a rejected amendment and gives the reason', async () => {
    await openLine();
    const row = within(itemFor('Boots'));
    expect(row.getByText('Rejected')).toBeInTheDocument();
    expect(row.getByText('+$90.00')).toHaveClass('line-through');
    expect(row.getByText('Rejected 10/2/2026 by Robin President: No vote recorded')).toBeInTheDocument();
  });

  it('says who confirmed a confirmed amendment', async () => {
    await openLine();
    expect(within(itemFor('Hose')).getByText('Confirmed 10/2/2026 by Robin President')).toBeInTheDocument();
  });

  it('says a reversal is awaiting confirmation rather than striking the amendment through', async () => {
    listAmendments.mockResolvedValue([
      amendment({
        id: 'am-reversed',
        reason: 'Gloves',
        reversedByAmendmentId: 'rev-1',
        reversedAt: '2026-10-08T15:00:00Z',
        reversedByName: 'Pat Treasurer',
        reversalStatus: 'pending',
      }),
    ]);
    await openLine();
    const row = within(itemFor('Gloves'));
    expect(row.getByText('+$250.00')).not.toHaveClass('line-through');
    expect(row.getByText('Reversal entered 10/8/2026 by Pat Treasurer, awaiting confirmation')).toBeInTheDocument();
  });
});

describe('who decides', () => {
  it('offers a budget reviewer Confirm and Reject on a pending amendment only', async () => {
    await openLine();
    expect(
      within(itemFor('Nozzles')).getByRole('button', { name: 'Confirm the 10/7/2026 amendment of +$400.00' })
    ).toBeInTheDocument();
    expect(
      within(itemFor('Nozzles')).getByRole('button', { name: 'Reject the 10/7/2026 amendment of +$400.00' })
    ).toBeInTheDocument();
    expect(within(itemFor('Boots')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(itemFor('Hose')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('hides Confirm on the viewer’s own entry and offers Withdraw instead of Reject', async () => {
    granted = new Set(['finance.view', 'finance.manage']);
    me = 'u-treasurer';
    await openLine();
    const row = within(itemFor('Nozzles'));
    expect(row.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Withdraw the 10/7/2026 amendment of +$400.00' })).toBeInTheDocument();
  });

  it('offers Reverse to a finance manager on a confirmed amendment, never a pending or rejected one', async () => {
    granted = new Set(['finance.view', 'finance.manage']);
    me = 'u-treasurer';
    await openLine();
    expect(within(itemFor('Hose')).getByRole('button', { name: /^Reverse/ })).toBeInTheDocument();
    expect(within(itemFor('Nozzles')).queryByRole('button', { name: /^Reverse/ })).not.toBeInTheDocument();
    expect(within(itemFor('Boots')).queryByRole('button', { name: /^Reverse/ })).not.toBeInTheDocument();
  });

  it('offers a finance viewer nothing to decide', async () => {
    granted = new Set(['finance.view']);
    await openLine();
    expect(within(itemFor('Nozzles')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers nothing in a locked year', async () => {
    storeState = { ...storeState, fiscalYears: [year('fy-open', true)] };
    await openLine();
    expect(within(itemFor('Nozzles')).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('deciding', () => {
  it('confirms after saying what it does, then re-fetches the line and its amendments', async () => {
    const user = userEvent.setup();
    await openLine();
    await user.click(within(itemFor('Nozzles')).getByRole('button', { name: /^Confirm the/ }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Confirm amendment' }));
    expect(
      dialog.getByText(
        "This raises the line's budget by $400.00. Confirm only if it matches what Board vote 10/7 approved."
      )
    ).toBeInTheDocument();
    expect(confirmAmendment).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Confirm amendment' }));

    await waitFor(() => expect(confirmAmendment).toHaveBeenCalledWith('b-open', 'am-pending'));
    expect(toastSuccess).toHaveBeenCalledWith('Amendment confirmed');
    await waitFor(() => expect(getBudget).toHaveBeenCalledTimes(2));
    expect(listAmendments).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when the confirmation is declined', async () => {
    const user = userEvent.setup();
    await openLine();
    await user.click(within(itemFor('Nozzles')).getByRole('button', { name: /^Confirm the/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Confirm amendment' })).getByRole('button', { name: 'Not yet' })
    );
    expect(confirmAmendment).not.toHaveBeenCalled();
  });

  it('rejects with the reason given', async () => {
    const user = userEvent.setup();
    await openLine();
    await user.click(within(itemFor('Nozzles')).getByRole('button', { name: /^Reject the/ }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Reject amendment' }));
    await user.type(dialog.getByLabelText(/Reason/), '  Not what the board approved ');
    await user.click(dialog.getByRole('button', { name: 'Reject' }));

    await waitFor(() =>
      expect(rejectAmendment).toHaveBeenCalledWith('b-open', 'am-pending', { note: 'Not what the board approved' })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Amendment rejected');
  });

  it('shows the API’s refusal in its own words', async () => {
    const user = userEvent.setup();
    confirmAmendment.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { detail: 'You cannot approve your own amendment.' } },
    });
    await openLine();
    await user.click(within(itemFor('Nozzles')).getByRole('button', { name: /^Confirm the/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Confirm amendment' })).getByRole('button', {
        name: 'Confirm amendment',
      })
    );
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('You cannot approve your own amendment.'));
  });
});
