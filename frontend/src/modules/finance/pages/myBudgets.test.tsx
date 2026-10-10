/**
 * A budget-line owner's view: "My Budgets", and the line's detail page read
 * without `finance.view`, with the transactions that moved its totals.
 *
 * Which lines a member owns, what is left on each and what moved it are all
 * the backend's answers; these screens group and word them. An owner reads
 * and never edits: no Edit, no Add amendment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { BudgetTransaction, MyBudget } from '../types';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p), user: { id: 'u-me' } }),
}));

const listMine = vi.fn();
const getBudget = vi.fn();
const listAmendments = vi.fn();
const listTransactions = vi.fn();
vi.mock('../services/api', () => ({
  budgetService: {
    listMine: (...args: unknown[]) => listMine(...args) as unknown,
    get: (...args: unknown[]) => getBudget(...args) as unknown,
    listAmendments: (...args: unknown[]) => listAmendments(...args) as unknown,
    listTransactions: (...args: unknown[]) => listTransactions(...args) as unknown,
  },
  financeOptionService: {
    positions: () => Promise.resolve([]),
    stations: () => Promise.resolve([]),
  },
}));

import MyBudgetsPage from './MyBudgetsPage';
import BudgetDetailPage from './BudgetDetailPage';
import { useOwnsBudgetsStore } from '../hooks/useOwnsBudgets';

const mine = (overrides: Partial<MyBudget>): MyBudget => ({
  id: 'b-1',
  organizationId: 'org',
  fiscalYearId: 'fy-2026',
  fiscalYearName: 'FY2026',
  fiscalYearStatus: 'active',
  categoryId: 'cat-training',
  categoryName: 'Training',
  amountBudgeted: '2000.00',
  amountSpent: '500.00',
  amountEncumbered: '250.00',
  amountRemaining: '1250.00',
  percentUsed: 37.5,
  originalAmount: '2000.00',
  amendmentsTotal: '0.00',
  amendmentCount: 0,
  stationId: null,
  stationName: null,
  effectiveOwnerPositionId: 'pos-to',
  effectiveOwnerPositionName: 'Training Officer',
  ownerInherited: true,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

// The backend's order: newest year first.
const lines = [
  mine({ id: 'b-next', fiscalYearId: 'fy-2027', fiscalYearName: 'FY2027', fiscalYearStatus: 'draft' }),
  mine({
    id: 'b-now',
    amountBudgeted: '2300.00',
    originalAmount: '2000.00',
    amendmentsTotal: '300.00',
    amendmentCount: 1,
  }),
  mine({
    id: 'b-station',
    stationId: 'st-2',
    stationName: 'Station 2',
    ownerInherited: false,
    effectiveOwnerPositionName: 'Training Officer',
  }),
  mine({ id: 'b-last', fiscalYearId: 'fy-2025', fiscalYearName: 'FY2025', fiscalYearStatus: 'closed' }),
];

const transaction = (n: number, overrides: Partial<BudgetTransaction> = {}): BudgetTransaction => ({
  id: `t-${String(n)}`,
  kind: 'purchase_request',
  entityId: `pr-${String(n)}`,
  number: `PR-${String(n).padStart(4, '0')}`,
  description: `Purchase ${String(n)}`,
  counterparty: 'Hose Supply Co',
  requesterName: 'Alice Test',
  status: 'paid',
  amount: '100.00',
  effect: 'spent',
  occurredAt: '2026-03-05T12:00:00Z',
  ...overrides,
});

const page = (items: BudgetTransaction[], total = items.length, offset = 0) => ({
  items,
  total,
  limit: 25,
  offset,
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmProvider>
        <Routes>
          <Route path="/finance/my-budgets" element={<MyBudgetsPage />} />
          <Route path="/finance/budgets/:id" element={<BudgetDetailPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [listMine, getBudget, listAmendments, listTransactions]) mock.mockReset();
  listMine.mockResolvedValue(lines);
  getBudget.mockImplementation((id: string) => Promise.resolve(lines.find((l) => l.id === id)));
  listAmendments.mockResolvedValue([]);
  listTransactions.mockResolvedValue(page([]));
  // A member who owns lines: every member's baseline grant, no finance.view.
  granted = new Set(['finance.request']);
  storeState = {
    fiscalYears: [],
    budgetCategories: [],
    fetchFiscalYears: vi.fn(),
    fetchBudgetCategories: vi.fn(),
  };
  useOwnsBudgetsStore.setState({ userId: null, ownsAny: false, loading: false });
});

describe('My Budgets', () => {
  it('groups the lines by fiscal year: current, then draft, then closed', async () => {
    renderAt('/finance/my-budgets');

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['FY2026Current year', 'FY2027Draft', 'FY2025Closed']);
    const current = screen.getByRole('region', { name: /FY2026/ });
    expect(within(current).getAllByRole('listitem')).toHaveLength(2);
  });

  it('names an inherited owner, the station, and the original of an amended line', async () => {
    renderAt('/finance/my-budgets');
    const current = await screen.findByRole('region', { name: /FY2026/ });
    const [amended, station] = within(current).getAllByRole('listitem');

    expect(amended).toHaveTextContent('Training · Department-wide');
    expect(amended).toHaveTextContent('Owner: Training Officer (from category)');
    expect(amended).toHaveTextContent('$2,300.00');
    expect(amended).toHaveTextContent('Original $2,000.00');
    expect(amended).toHaveTextContent('Committed$250.00');
    expect(amended).toHaveTextContent('Remaining$1,250.00');
    expect(amended).toHaveTextContent('37.5% used');
    expect(within(current).getAllByRole('link')[0]).toHaveAttribute('href', '/finance/budgets/b-now');

    expect(station).toHaveTextContent('Training · Station 2');
    expect(station).toHaveTextContent('Owner: Training Officer');
    expect(station).not.toHaveTextContent('(from category)');
  });

  it('explains how a line comes to appear when the member owns none', async () => {
    listMine.mockResolvedValue([]);
    renderAt('/finance/my-budgets');

    expect(await screen.findByRole('heading', { name: "You don't own any budget lines" })).toBeInTheDocument();
    expect(screen.getByText(/when the Treasurer makes your position its owner/)).toBeInTheDocument();
    await waitFor(() => expect(useOwnsBudgetsStore.getState()).toMatchObject({ userId: 'u-me', ownsAny: false }));
  });

  it('tells the navigation what it found', async () => {
    renderAt('/finance/my-budgets');
    await screen.findAllByRole('heading', { level: 2 });
    expect(useOwnsBudgetsStore.getState()).toMatchObject({ userId: 'u-me', ownsAny: true });
  });
});

describe('Budget detail, for the line’s owner', () => {
  it('loads the line by id and offers no Edit or Add amendment', async () => {
    renderAt('/finance/budgets/b-now');

    expect(await screen.findByRole('heading', { name: 'Training' })).toBeInTheDocument();
    expect(getBudget).toHaveBeenCalledWith('b-now');
    expect(screen.getByText('Training Officer (from category)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add amendment' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to My Budgets' })).toHaveAttribute('href', '/finance/my-budgets');
  });

  it('says the line is not found when the API refuses it', async () => {
    getBudget.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 404',
      response: { status: 404, data: { detail: 'Budget not found' } },
    });
    renderAt('/finance/budgets/b-someone-elses');

    expect(await screen.findByRole('heading', { name: 'Budget not found' })).toBeInTheDocument();
  });

  it('keeps Edit and Back to Budgets for a finance manager', async () => {
    granted = new Set(['finance.view', 'finance.manage']);
    renderAt('/finance/budgets/b-now');

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Budgets' })).toHaveAttribute('href', '/finance/budgets');
  });
});

describe('Transaction history', () => {
  it('lists each transaction with its date, number, requester and effect', async () => {
    listTransactions.mockResolvedValue(
      page([
        transaction(2, { effect: 'encumbered', status: 'approved', amount: '75.00' }),
        transaction(1),
        transaction(3, {
          kind: 'check_request',
          number: 'CR-0003',
          status: 'voided',
          effect: 'none',
          counterparty: 'County Training Center',
          occurredAt: '2026-02-01T12:00:00Z',
        }),
      ])
    );
    renderAt('/finance/budgets/b-now');

    const list = await screen.findByRole('list', { name: 'Transactions' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Purchase request PR-0002');
    expect(items[0]).toHaveTextContent('Committed');
    expect(items[0]).toHaveTextContent('$75.00');
    expect(items[1]).toHaveTextContent('Spent');
    expect(items[1]).toHaveTextContent('3/5/2026 · Hose Supply Co · Requested by Alice Test · Paid');
    expect(items[2]).toHaveTextContent('Check request CR-0003');
    expect(items[2]).toHaveTextContent('Reversed');
    expect(listTransactions).toHaveBeenCalledWith('b-now', { limit: 25, offset: 0 });
  });

  it('does not link an owner to other members’ requests', async () => {
    listTransactions.mockResolvedValue(page([transaction(1)]));
    renderAt('/finance/budgets/b-now');

    const list = await screen.findByRole('list', { name: 'Transactions' });
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('links a finance viewer to the request', async () => {
    granted = new Set(['finance.view']);
    listTransactions.mockResolvedValue(page([transaction(1)]));
    renderAt('/finance/budgets/b-now');

    const list = await screen.findByRole('list', { name: 'Transactions' });
    expect(within(list).getByRole('link', { name: 'PR-0001' })).toHaveAttribute(
      'href',
      '/finance/purchase-requests/pr-1'
    );
  });

  it('pages through a long history', async () => {
    const user = userEvent.setup();
    listTransactions.mockImplementation((_id: string, params: { offset: number }) =>
      Promise.resolve(
        params.offset === 0
          ? page(
              Array.from({ length: 25 }, (_, i) => transaction(i + 1)),
              30
            )
          : page(
              Array.from({ length: 5 }, (_, i) => transaction(i + 26)),
              30,
              25
            )
      )
    );
    renderAt('/finance/budgets/b-now');

    await screen.findByText('Purchase request PR-0001', { exact: false });
    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(listTransactions).toHaveBeenLastCalledWith('b-now', { limit: 25, offset: 25 }));
    const list = await screen.findByRole('list', { name: 'Transactions' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(5));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('PR-0026');
  });

  it('says so when nothing has moved the line yet', async () => {
    renderAt('/finance/budgets/b-now');

    expect(await screen.findByRole('heading', { name: 'No transactions yet' })).toBeInTheDocument();
  });
});
