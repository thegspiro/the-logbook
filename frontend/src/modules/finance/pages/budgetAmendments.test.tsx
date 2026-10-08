/**
 * Budget amendments — extra money leadership approved for a budget line.
 *
 * The backend raises the line's budget by each amendment and reports the
 * original beside it; the detail page shows both, lists the amendments, and
 * offers "Add amendment" to a finance manager unless the year is locked. In a
 * locked year the edit dialog's amount is read-only and is not sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Budget, BudgetAmendment, BudgetCategory, FiscalYear } from '../types';

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
const updateBudget = vi.fn();
const listAmendments = vi.fn();
const addAmendment = vi.fn();
vi.mock('../services/api', () => ({
  budgetService: {
    get: (...args: unknown[]) => getBudget(...args) as unknown,
    listTransactions: () => Promise.resolve({ items: [], total: 0, limit: 25, offset: 0 }),
    update: (...args: unknown[]) => updateBudget(...args) as unknown,
    listAmendments: (...args: unknown[]) => listAmendments(...args) as unknown,
    addAmendment: (...args: unknown[]) => addAmendment(...args) as unknown,
  },
  financeOptionService: {
    positions: () => Promise.resolve([]),
    stations: () => Promise.resolve([]),
  },
}));

import BudgetDetailPage from './BudgetDetailPage';
import BudgetsPage from './BudgetsPage';

const year = (id: string, name: string, locked: boolean): FiscalYear => ({
  id,
  organizationId: 'org',
  name,
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  status: locked ? 'closed' : 'active',
  isLocked: locked,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const gear: BudgetCategory = {
  id: 'cat-gear',
  organizationId: 'org',
  name: 'Gear',
  sortOrder: 0,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const line = (overrides: Partial<Budget>): Budget => ({
  id: 'b-amended',
  organizationId: 'org',
  fiscalYearId: 'fy-open',
  categoryId: 'cat-gear',
  categoryName: 'Gear',
  amountBudgeted: '1050.00',
  amountSpent: '100.00',
  amountEncumbered: '0.00',
  originalAmount: '800.00',
  amendmentsTotal: '250.00',
  amendmentCount: 2,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const budgets = [
  line({}),
  line({
    id: 'b-plain',
    amountBudgeted: '800.00',
    originalAmount: '800.00',
    amendmentsTotal: '0.00',
    amendmentCount: 0,
  }),
  line({ id: 'b-locked', fiscalYearId: 'fy-locked', amendmentCount: 0, amendmentsTotal: '0.00' }),
];

const amendments: BudgetAmendment[] = [
  {
    id: 'am-2',
    organizationId: 'org',
    budgetId: 'b-amended',
    amount: '200.00',
    reason: 'Hose replacement',
    approvedBy: 'Board vote 10/7',
    approvedOn: '2026-10-07',
    createdBy: 'u-t',
    enteredByName: 'Pat Treasurer',
    createdAt: '2026-10-08T14:30:00Z',
  },
  {
    id: 'am-1',
    organizationId: 'org',
    budgetId: 'b-amended',
    amount: '50.00',
    reason: 'Extra gloves',
    approvedBy: 'Chief',
    approvedOn: '2026-09-15',
    createdBy: null,
    enteredByName: null,
    createdAt: '2026-09-16T12:00:00Z',
  },
];

const fetchBudgets = vi.fn();

/** Render the detail page and wait for the line, which it fetches by id. */
const openLine = async (id: string) => {
  render(
    <MemoryRouter initialEntries={[`/finance/budgets/${id}`]}>
      <Routes>
        <Route path="/finance/budgets/:id" element={<BudgetDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Gear' });
};

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [getBudget, updateBudget, listAmendments, addAmendment]) mock.mockReset();
  getBudget.mockImplementation((id: string) => Promise.resolve(budgets.find((b) => b.id === id)));
  listAmendments.mockImplementation((id: string) => Promise.resolve(id === 'b-amended' ? amendments : []));
  granted = new Set(['finance.view', 'finance.manage']);
  storeState = {
    fiscalYears: [year('fy-open', 'FY2026', false), year('fy-locked', 'FY2024', true)],
    budgets,
    budgetCategories: [gear],
    isLoading: false,
    error: null,
    fetchFiscalYears: vi.fn(),
    fetchBudgets,
    fetchBudgetCategories: vi.fn(),
  };
});

describe('Budget detail — original and current budget', () => {
  it('shows the original, the current and the amendments total when amended', async () => {
    await openLine('b-amended');

    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    const values = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(values[terms.indexOf('Original budget')]).toBe('$800.00');
    expect(values[terms.indexOf('Current budget')]).toBe('$1,050.00');
    expect(values[terms.indexOf('Amendments')]).toBe('+$250.00 (2)');
    expect(screen.getByText('+$250.00 (2)')).toBeInTheDocument();
    await waitFor(() => expect(listAmendments).toHaveBeenCalledWith('b-amended'));
  });

  it('shows a plain "Budgeted" figure for a line never amended', async () => {
    await openLine('b-plain');

    expect(screen.queryByText('Original budget')).not.toBeInTheDocument();
    expect(screen.getByText('Budgeted')).toBeInTheDocument();
    expect(await screen.findByText('No amendments have been recorded for this line.')).toBeInTheDocument();
  });
});

describe('Budget detail — amendments list', () => {
  it('lists each amendment with its approval, reason and who entered it', async () => {
    granted = new Set(['finance.view']);
    await openLine('b-amended');

    const list = await screen.findByRole('list', { name: 'Amendments' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('+$200.00');
    expect(items[0]).toHaveTextContent('Approved 10/7/2026 by Board vote 10/7');
    expect(items[0]).toHaveTextContent('Hose replacement');
    expect(items[0]).toHaveTextContent('Entered by Pat Treasurer on Thursday, October 8, 2026');
    expect(items[1]).toHaveTextContent('Approved 9/15/2026 by Chief');
    expect(items[1]).toHaveTextContent('Entered by a former member');
  });
});

describe('Budget detail — Add amendment', () => {
  it('is offered to a finance manager in an open year', async () => {
    await openLine('b-amended');
    expect(screen.getByRole('button', { name: 'Add amendment' })).toBeInTheDocument();
  });

  it('is hidden from a viewer', async () => {
    granted = new Set(['finance.view']);
    await openLine('b-amended');
    expect(screen.queryByRole('button', { name: 'Add amendment' })).not.toBeInTheDocument();
  });

  it('is hidden when the fiscal year is locked', async () => {
    await openLine('b-locked');
    expect(screen.queryByRole('button', { name: 'Add amendment' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('records an amendment with every field, then re-fetches the line and its amendments', async () => {
    const user = userEvent.setup();
    addAmendment.mockResolvedValue({ amendment: amendments[0], budget: budgets[0] });
    await openLine('b-plain');
    await waitFor(() => expect(listAmendments).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Add amendment' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Approval date')).toHaveValue(today());

    await user.type(within(dialog).getByLabelText('Amount added'), '250.5');
    await user.type(within(dialog).getByLabelText('Reason'), '  Hose replacement  ');
    await user.type(within(dialog).getByLabelText('Approved by'), 'Board vote 10/7');
    await user.clear(within(dialog).getByLabelText('Approval date'));
    await user.type(within(dialog).getByLabelText('Approval date'), '2026-10-07');
    await user.click(within(dialog).getByRole('button', { name: 'Record amendment' }));

    await waitFor(() =>
      expect(addAmendment).toHaveBeenCalledWith('b-plain', {
        amount: '250.50',
        reason: 'Hose replacement',
        approvedBy: 'Board vote 10/7',
        approvedOn: '2026-10-07',
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Amendment recorded');
    await waitFor(() => expect(getBudget).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listAmendments).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses a missing amount, reason and approver without calling the API', async () => {
    const user = userEvent.setup();
    await openLine('b-plain');

    await user.click(screen.getByRole('button', { name: 'Add amendment' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Record amendment' }));

    expect(within(dialog).getByText('Enter an amount greater than zero.')).toBeInTheDocument();
    expect(within(dialog).getByText('Give a reason for the amendment.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Say who approved it/)).toBeInTheDocument();
    expect(addAmendment).not.toHaveBeenCalled();
  });

  it('refuses a zero amount and a future date', async () => {
    const user = userEvent.setup();
    await openLine('b-plain');

    await user.click(screen.getByRole('button', { name: 'Add amendment' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount added');
    await user.type(within(dialog).getByLabelText('Reason'), 'r');
    await user.type(within(dialog).getByLabelText('Approved by'), 'Chief');

    await user.type(amount, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Record amendment' }));
    expect(within(dialog).getByText('Enter an amount greater than zero.')).toBeInTheDocument();

    await user.clear(amount);
    await user.type(amount, '10');
    const date = within(dialog).getByLabelText('Approval date');
    await user.clear(date);
    await user.type(date, '2999-01-01');
    await user.click(within(dialog).getByRole('button', { name: 'Record amendment' }));
    expect(within(dialog).getByText('The approval date cannot be in the future.')).toBeInTheDocument();

    expect(addAmendment).not.toHaveBeenCalled();
  });

  it("shows the API's message when the amendment is refused", async () => {
    const user = userEvent.setup();
    addAmendment.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: { detail: 'This fiscal year is locked. Budget amounts can no longer be changed or amended.' },
      },
    });
    await openLine('b-plain');

    await user.click(screen.getByRole('button', { name: 'Add amendment' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount added'), '10');
    await user.type(within(dialog).getByLabelText('Reason'), 'r');
    await user.type(within(dialog).getByLabelText('Approved by'), 'Chief');
    await user.click(within(dialog).getByRole('button', { name: 'Record amendment' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'This fiscal year is locked. Budget amounts can no longer be changed or amended.'
      )
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Edit dialog in a locked year', () => {
  it('makes the amount read-only and leaves it out of the save', async () => {
    const user = userEvent.setup();
    updateBudget.mockResolvedValue(budgets[2]);
    await openLine('b-locked');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount budgeted');
    expect(amount).toHaveAttribute('readonly');
    expect(within(dialog).getByText('This fiscal year is locked.')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Notes'), 'Audited');
    await user.click(within(dialog).getByRole('button', { name: 'Save budget line' }));

    await waitFor(() =>
      expect(updateBudget).toHaveBeenCalledWith('b-locked', {
        notes: 'Audited',
        stationId: null,
        ownerPositionId: null,
      })
    );
  });

  it('keeps the amount editable in an open year', async () => {
    const user = userEvent.setup();
    await openLine('b-plain');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Amount budgeted')).not.toHaveAttribute('readonly');
    expect(within(dialog).queryByText('This fiscal year is locked.')).not.toBeInTheDocument();
  });
});

describe('Budgets list', () => {
  it('marks an amended line beside its budgeted amount', () => {
    render(
      <MemoryRouter initialEntries={['/finance/budgets']}>
        <Routes>
          <Route path="/finance/budgets" element={<BudgetsPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getAllByText('(amended)')).toHaveLength(1);
  });
});
