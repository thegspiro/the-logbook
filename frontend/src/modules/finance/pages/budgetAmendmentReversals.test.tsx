/**
 * Reversing a mistaken budget amendment.
 *
 * A mistaken amendment is corrected by a reversing entry, never edited (owner
 * decision, 2026-10-09). The detail page offers "Reverse" on an amendment to a
 * finance manager — not on a reversal, not on an amendment already reversed,
 * not in a locked year, and never to a line's owner, who reads the list. It
 * renders what the backend reports about each row: a reversal as "−$X ·
 * Reverses the … amendment of +$Y", a reversed amendment struck through with
 * who reversed it and when.
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
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p), user: { id: 'u-me' } }),
}));

const getBudget = vi.fn();
const listAmendments = vi.fn();
const reverseAmendment = vi.fn();
vi.mock('../services/api', () => ({
  budgetService: {
    get: (...args: unknown[]) => getBudget(...args) as unknown,
    listTransactions: () => Promise.resolve({ items: [], total: 0, limit: 25, offset: 0 }),
    listAmendments: (...args: unknown[]) => listAmendments(...args) as unknown,
    reverseAmendment: (...args: unknown[]) => reverseAmendment(...args) as unknown,
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

const line = (overrides: Partial<Budget>): Budget => ({
  id: 'b-open',
  organizationId: 'org',
  fiscalYearId: 'fy-open',
  categoryId: 'cat-gear',
  categoryName: 'Gear',
  amountBudgeted: '1050.00',
  amountSpent: '100.00',
  amountEncumbered: '0.00',
  originalAmount: '800.00',
  amendmentsTotal: '250.00',
  amendmentCount: 3,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const budgets = [line({}), line({ id: 'b-locked', fiscalYearId: 'fy-locked' })];

const amendment = (overrides: Partial<BudgetAmendment>): BudgetAmendment => ({
  id: 'am-x',
  organizationId: 'org',
  budgetId: 'b-open',
  amount: '250.00',
  reason: 'Hose',
  approvedBy: 'Board vote 9/30',
  approvedOn: '2026-09-30',
  createdBy: 'u-t',
  enteredByName: 'Pat Treasurer',
  createdAt: '2026-10-01T12:00:00Z',
  isReversal: false,
  reversesAmendmentId: null,
  reversedByAmendmentId: null,
  reversedAt: null,
  reversedByName: null,
  ...overrides,
});

// Newest first, as the API lists them.
const rows: BudgetAmendment[] = [
  amendment({
    id: 'rev-1',
    amount: '-2500.00',
    reason: 'Entered $2,500 for $250',
    approvedBy: 'Chief',
    approvedOn: '2026-10-08',
    createdAt: '2026-10-08T15:00:00Z',
    isReversal: true,
    reversesAmendmentId: 'am-typo',
  }),
  amendment({
    id: 'am-typo',
    amount: '2500.00',
    reason: 'Gloves',
    approvedBy: 'Board vote 10/7',
    approvedOn: '2026-10-07',
    createdAt: '2026-10-07T12:00:00Z',
    reversedByAmendmentId: 'rev-1',
    reversedAt: '2026-10-08T15:00:00Z',
    reversedByName: 'Pat Treasurer',
  }),
  amendment({ id: 'am-hose' }),
];

const openLine = async (id: string) => {
  render(
    <MemoryRouter initialEntries={[`/finance/budgets/${id}`]}>
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

/** The list item whose text includes `text`. */
const itemFor = (text: string): HTMLElement => {
  const list = screen.getByRole('list', { name: 'Amendments' });
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => li.textContent.includes(text));
  if (!item) throw new Error(`no amendment row containing ${text}`);
  return item;
};

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [getBudget, listAmendments, reverseAmendment]) mock.mockReset();
  getBudget.mockImplementation((id: string) => Promise.resolve(budgets.find((b) => b.id === id)));
  listAmendments.mockResolvedValue(rows);
  granted = new Set(['finance.view', 'finance.manage']);
  storeState = {
    fiscalYears: [year('fy-open', false), year('fy-locked', true)],
    budgets,
    budgetCategories: [],
    isLoading: false,
    error: null,
    fetchFiscalYears: vi.fn(),
    fetchBudgets: vi.fn(),
    fetchBudgetCategories: vi.fn(),
  };
});

describe('Amendments list — reversals', () => {
  it('shows a reversal as a negative entry naming the amendment it reverses', async () => {
    await openLine('b-open');
    const reversal = within(itemFor('Entered $2,500 for $250'));
    expect(reversal.getByText(/^−\$2,500\.00/)).toBeInTheDocument();
    expect(reversal.getByText('· Reverses the 10/7/2026 amendment of +$2,500.00')).toBeInTheDocument();
  });

  it('strikes through a reversed amendment and says who reversed it and when', async () => {
    await openLine('b-open');
    const reversed = within(itemFor('Gloves'));
    expect(reversed.getByText('+$2,500.00')).toHaveClass('line-through');
    expect(reversed.getByText('Reversed 10/8/2026 by Pat Treasurer')).toBeInTheDocument();

    const untouched = within(itemFor('Hose'));
    expect(untouched.getByText('+$250.00')).not.toHaveClass('line-through');
    expect(untouched.queryByText(/^Reversed /)).not.toBeInTheDocument();
  });

  it('names a reverser who has since left as a former member', async () => {
    listAmendments.mockResolvedValue([rows[0], { ...rows[1], reversedByName: null }, rows[2]]);
    await openLine('b-open');
    expect(within(itemFor('Gloves')).getByText('Reversed 10/8/2026 by a former member')).toBeInTheDocument();
  });
});

describe('Reverse button', () => {
  it('is offered to a finance manager only on an amendment not yet reversed', async () => {
    const list = within(await openLine('b-open'));
    const buttons = list.getAllByRole('button', { name: /^Reverse/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Reverse the 9/30/2026 amendment of +$250.00');
    expect(within(itemFor('Hose')).getByRole('button', { name: /^Reverse/ })).toBeInTheDocument();
    expect(within(itemFor('Gloves')).queryByRole('button', { name: /^Reverse/ })).not.toBeInTheDocument();
    expect(within(itemFor('Entered $2,500')).queryByRole('button', { name: /^Reverse/ })).not.toBeInTheDocument();
  });

  it('is hidden in a locked fiscal year', async () => {
    const list = within(await openLine('b-locked'));
    expect(list.queryByRole('button', { name: /^Reverse/ })).not.toBeInTheDocument();
  });

  it('is hidden from a finance viewer', async () => {
    granted = new Set(['finance.view']);
    const list = within(await openLine('b-open'));
    expect(list.queryByRole('button', { name: /^Reverse/ })).not.toBeInTheDocument();
  });

  it("is hidden from the line's owner, who still sees the reversal", async () => {
    granted = new Set();
    const list = within(await openLine('b-open'));
    expect(list.queryByRole('button', { name: /^Reverse/ })).not.toBeInTheDocument();
    expect(within(itemFor('Gloves')).getByText('Reversed 10/8/2026 by Pat Treasurer')).toBeInTheDocument();
  });
});

describe('Reverse amendment dialog', () => {
  const open = async () => {
    const user = userEvent.setup();
    await openLine('b-open');
    await user.click(within(itemFor('Hose')).getByRole('button', { name: /^Reverse/ }));
    const dialog = within(await screen.findByRole('dialog'));
    return { user, dialog };
  };

  it('states the consequence before anything is saved', async () => {
    const { dialog } = await open();
    expect(
      dialog.getByText(
        'Once a second officer confirms it, this lowers the current budget by $250.00. The original amendment stays on record.'
      )
    ).toBeInTheDocument();
    expect(dialog.getByLabelText('Approval date')).toHaveValue(today());
  });

  it('records the reversal, then re-fetches the line and its amendments', async () => {
    reverseAmendment.mockResolvedValue({ amendment: rows[0], budget: budgets[0] });
    const { user, dialog } = await open();
    await waitFor(() => expect(listAmendments).toHaveBeenCalledTimes(1));

    await user.type(dialog.getByLabelText('Reason'), '  Entered twice  ');
    await user.type(dialog.getByLabelText('Approved by'), 'Chief');
    await user.clear(dialog.getByLabelText('Approval date'));
    await user.type(dialog.getByLabelText('Approval date'), '2026-10-08');
    await user.click(dialog.getByRole('button', { name: 'Record reversal' }));

    await waitFor(() =>
      expect(reverseAmendment).toHaveBeenCalledWith('b-open', 'am-hose', {
        reason: 'Entered twice',
        approvedBy: 'Chief',
        approvedOn: '2026-10-08',
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Reversal recorded — awaiting confirmation by a second officer');
    await waitFor(() => expect(getBudget).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listAmendments).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses a blank reason and approver without calling the API', async () => {
    const { user, dialog } = await open();
    await user.type(dialog.getByLabelText('Reason'), '   ');
    await user.click(dialog.getByRole('button', { name: 'Record reversal' }));

    expect(dialog.getByText('Give a reason for the reversal.')).toBeInTheDocument();
    expect(dialog.getByText('Say who approved the reversal.')).toBeInTheDocument();
    expect(reverseAmendment).not.toHaveBeenCalled();
  });

  it('refuses a future approval date without calling the API', async () => {
    const { user, dialog } = await open();
    await user.type(dialog.getByLabelText('Reason'), 'r');
    await user.type(dialog.getByLabelText('Approved by'), 'Chief');
    await user.clear(dialog.getByLabelText('Approval date'));
    await user.type(dialog.getByLabelText('Approval date'), '2999-01-01');
    await user.click(dialog.getByRole('button', { name: 'Record reversal' }));

    expect(dialog.getByText('The approval date cannot be in the future.')).toBeInTheDocument();
    expect(reverseAmendment).not.toHaveBeenCalled();
  });

  it("shows the API's message and stays open when the reversal is refused", async () => {
    reverseAmendment.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: { status: 409, data: { detail: 'Insufficient available budget' } },
    });
    const { user, dialog } = await open();
    await user.type(dialog.getByLabelText('Reason'), 'r');
    await user.type(dialog.getByLabelText('Approved by'), 'Chief');
    await user.click(dialog.getByRole('button', { name: 'Record reversal' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Insufficient available budget'));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(getBudget).toHaveBeenCalledTimes(1);
  });
});
