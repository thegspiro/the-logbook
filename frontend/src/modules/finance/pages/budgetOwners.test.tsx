/**
 * The Treasurer's Create/Edit Budget screen, and budget-line owners.
 *
 * A line is owned by a position; with none of its own it inherits its
 * category's, which the backend resolves and the screens only word. Only
 * `finance.manage` sees the add and edit controls. On edit, a cleared owner or
 * station goes as `null` so it is actually cleared (CLAUDE.md pitfall #1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { Budget, BudgetCategory, FiscalYear } from '../types';

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

const createBudget = vi.fn();
const updateBudget = vi.fn();
const createCategory = vi.fn();
const updateCategory = vi.fn();
const positionOptions = vi.fn();
const stationOptions = vi.fn();
vi.mock('../services/api', () => ({
  budgetService: {
    create: (...args: unknown[]) => createBudget(...args) as unknown,
    update: (...args: unknown[]) => updateBudget(...args) as unknown,
    listAmendments: () => Promise.resolve([]),
  },
  budgetCategoryService: {
    create: (...args: unknown[]) => createCategory(...args) as unknown,
    update: (...args: unknown[]) => updateCategory(...args) as unknown,
    delete: vi.fn(),
  },
  fiscalYearService: { lock: vi.fn() },
  financeOptionService: {
    positions: () => positionOptions() as unknown,
    stations: () => stationOptions() as unknown,
  },
}));

import BudgetsPage from './BudgetsPage';
import BudgetDetailPage from './BudgetDetailPage';
import FiscalYearSettingsPage from './FiscalYearSettingsPage';

const year = (id: string, name: string, status: FiscalYear['status']): FiscalYear => ({
  id,
  organizationId: 'org',
  name,
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  status,
  isLocked: status === 'closed',
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const category = (id: string, name: string, owner?: string): BudgetCategory => ({
  id,
  organizationId: 'org',
  name,
  sortOrder: 0,
  isActive: true,
  ownerPositionId: owner ? `pos-${owner}` : null,
  ownerPositionName: owner ?? null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const line = (overrides: Partial<Budget>): Budget => ({
  id: 'b-1',
  organizationId: 'org',
  fiscalYearId: 'fy-active',
  categoryId: 'cat-training',
  amountBudgeted: '2000.00',
  amountSpent: '500.00',
  amountEncumbered: '250.00',
  stationId: null,
  stationName: null,
  ownerPositionId: null,
  ownerPositionName: null,
  effectiveOwnerPositionId: null,
  effectiveOwnerPositionName: null,
  ownerInherited: false,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const fiscalYears = [
  year('fy-active', 'FY2026', 'active'),
  year('fy-draft', 'FY2027', 'draft'),
  year('fy-closed', 'FY2025', 'closed'),
];
const categories = [category('cat-training', 'Training', 'Training Officer'), category('cat-gear', 'Gear')];
const budgets = [
  line({
    id: 'b-training',
    effectiveOwnerPositionId: 'pos-Training Officer',
    effectiveOwnerPositionName: 'Training Officer',
    ownerInherited: true,
  }),
  line({
    id: 'b-chief',
    amountBudgeted: '300.00',
    amountSpent: '0.00',
    amountEncumbered: '0.00',
    stationId: 'st-2',
    stationName: 'Station 2',
    ownerPositionId: 'pos-chief',
    ownerPositionName: 'Chief',
    effectiveOwnerPositionId: 'pos-chief',
    effectiveOwnerPositionName: 'Chief',
  }),
  line({ id: 'b-gear', categoryId: 'cat-gear', amountBudgeted: '800.00' }),
];

const fetchBudgets = vi.fn();
const fetchBudgetCategories = vi.fn();
const fetchFiscalYears = vi.fn();

const renderAt = (path: string, pattern: string, Page: React.FC) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={<Page />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [createBudget, updateBudget, createCategory, updateCategory, positionOptions, stationOptions]) {
    mock.mockReset();
  }
  positionOptions.mockResolvedValue([
    { id: 'pos-chief', name: 'Chief' },
    { id: 'pos-Training Officer', name: 'Training Officer' },
  ]);
  stationOptions.mockResolvedValue([{ id: 'st-2', name: 'Station 2' }]);
  granted = new Set(['finance.view', 'finance.manage']);
  storeState = {
    fiscalYears,
    budgets,
    budgetCategories: categories,
    isLoading: false,
    error: null,
    fetchFiscalYears,
    fetchBudgets,
    fetchBudgetCategories,
    activateFiscalYear: vi.fn(),
    createFiscalYear: vi.fn(),
  };
});

// =============================================================================
// Budgets list
// =============================================================================

describe('BudgetsPage', () => {
  it('shows station and owner columns, naming an inherited owner', () => {
    renderAt('/finance/budgets', '/finance/budgets', BudgetsPage);

    expect(screen.getByRole('columnheader', { name: 'Station' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();
    expect(screen.getByText('Training Officer (from category)')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Chief' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Station 2' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: 'Department-wide' })).toHaveLength(2);
  });

  it('filters the rows by station', async () => {
    const user = userEvent.setup();
    renderAt('/finance/budgets', '/finance/budgets', BudgetsPage);

    expect(screen.getAllByRole('row')).toHaveLength(5); // header + 3 + total
    await user.selectOptions(screen.getByRole('combobox', { name: 'Station' }), 'st-2');
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] ?? document.body).getByText('Chief')).toBeInTheDocument();
  });

  it('offers Add budget line to a finance manager only', () => {
    granted = new Set(['finance.view']);
    const { unmount } = renderAt('/finance/budgets', '/finance/budgets', BudgetsPage);
    expect(screen.queryByRole('button', { name: /add budget line/i })).not.toBeInTheDocument();
    unmount();

    granted = new Set(['finance.view', 'finance.manage']);
    renderAt('/finance/budgets', '/finance/budgets', BudgetsPage);
    expect(screen.getByRole('button', { name: /add budget line/i })).toBeInTheDocument();
  });

  it('creates a line with station and owner, then re-fetches the year', async () => {
    const user = userEvent.setup();
    createBudget.mockResolvedValue(line({ id: 'b-new', fiscalYearId: 'fy-active' }));
    renderAt('/finance/budgets', '/finance/budgets', BudgetsPage);
    await waitFor(() => expect(fetchBudgets).toHaveBeenCalledWith({ fiscalYearId: 'fy-active' }));
    fetchBudgets.mockClear();

    await user.click(screen.getByRole('button', { name: /add budget line/i }));
    const dialog = await screen.findByRole('dialog');
    // Closed years take no new lines.
    const yearSelect = within(dialog).getByLabelText('Fiscal year');
    expect(within(yearSelect).queryByText(/FY2025/)).not.toBeInTheDocument();
    expect(yearSelect).toHaveValue('fy-active');

    await user.selectOptions(within(dialog).getByLabelText('Category'), 'cat-gear');
    await within(dialog).findByRole('option', { name: 'Station 2' });
    await user.selectOptions(within(dialog).getByLabelText('Station'), 'st-2');
    await user.type(within(dialog).getByLabelText('Amount budgeted'), '1200');
    await within(dialog).findByRole('option', { name: 'Chief' });
    await user.selectOptions(within(dialog).getByLabelText('Owner position'), 'pos-chief');
    await user.click(within(dialog).getByRole('button', { name: 'Add budget line' }));

    await waitFor(() =>
      expect(createBudget).toHaveBeenCalledWith({
        fiscalYearId: 'fy-active',
        categoryId: 'cat-gear',
        amountBudgeted: '1200.00',
        notes: undefined,
        stationId: 'st-2',
        ownerPositionId: 'pos-chief',
      })
    );
    await waitFor(() => expect(fetchBudgets).toHaveBeenCalledWith({ fiscalYearId: 'fy-active' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('omits a blank station and owner on create, and explains the inherited owner', async () => {
    const user = userEvent.setup();
    createBudget.mockResolvedValue(line({ id: 'b-new', fiscalYearId: 'fy-draft' }));
    renderAt('/finance/budgets', '/finance/budgets', BudgetsPage);

    await user.click(screen.getByRole('button', { name: /add budget line/i }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Fiscal year'), 'fy-draft');

    await user.selectOptions(within(dialog).getByLabelText('Category'), 'cat-gear');
    expect(within(dialog).getByText('No owner')).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'cat-training');
    expect(within(dialog).getByText("Uses the category's owner: Training Officer")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Amount budgeted'), '50');
    await user.click(within(dialog).getByRole('button', { name: 'Add budget line' }));

    await waitFor(() =>
      expect(createBudget).toHaveBeenCalledWith({
        fiscalYearId: 'fy-draft',
        categoryId: 'cat-training',
        amountBudgeted: '50.00',
        notes: undefined,
        stationId: undefined,
        ownerPositionId: undefined,
      })
    );
  });

  it('refuses a missing amount without calling the API', async () => {
    const user = userEvent.setup();
    renderAt('/finance/budgets', '/finance/budgets', BudgetsPage);

    await user.click(screen.getByRole('button', { name: /add budget line/i }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'cat-gear');
    await user.click(within(dialog).getByRole('button', { name: 'Add budget line' }));

    expect(within(dialog).getByText('Enter an amount of zero or more.')).toBeInTheDocument();
    expect(createBudget).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Budget detail
// =============================================================================

describe('BudgetDetailPage', () => {
  const openChief = () => renderAt('/finance/budgets/b-chief', '/finance/budgets/:id', BudgetDetailPage);

  it('shows the station and owner', () => {
    granted = new Set(['finance.view']);
    renderAt('/finance/budgets/b-training', '/finance/budgets/:id', BudgetDetailPage);

    expect(screen.getByText('Department-wide')).toBeInTheDocument();
    expect(screen.getByText('Training Officer (from category)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('edits with every field, sending null for a cleared owner and station', async () => {
    const user = userEvent.setup();
    updateBudget.mockResolvedValue(line({ id: 'b-chief' }));
    openChief();
    expect(screen.getByText('Station 2')).toBeInTheDocument();
    fetchBudgets.mockClear();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/FY2026 · Training/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Amount budgeted')).toHaveValue(300);
    expect(within(dialog).getByLabelText('Owner position')).toHaveValue('pos-chief');
    expect(within(dialog).getByLabelText('Station')).toHaveValue('st-2');

    await user.selectOptions(within(dialog).getByLabelText('Owner position'), '');
    expect(within(dialog).getByText("Uses the category's owner: Training Officer")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Station'), '');
    await user.click(within(dialog).getByRole('button', { name: 'Save budget line' }));

    await waitFor(() =>
      expect(updateBudget).toHaveBeenCalledWith('b-chief', {
        amountBudgeted: '300.00',
        notes: null,
        stationId: null,
        ownerPositionId: null,
      })
    );
    await waitFor(() => expect(fetchBudgets).toHaveBeenCalled());
  });

  it("shows the API's message when the amount is refused", async () => {
    const user = userEvent.setup();
    updateBudget.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: { status: 409, data: { detail: 'Insufficient available budget' } },
    });
    renderAt('/finance/budgets/b-training', '/finance/budgets/:id', BudgetDetailPage);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount budgeted');
    await user.clear(amount);
    await user.type(amount, '100');
    await user.click(within(dialog).getByRole('button', { name: 'Save budget line' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Insufficient available budget'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// =============================================================================
// Category owner
// =============================================================================

describe('FiscalYearSettingsPage category owner', () => {
  it('creates a category with an owner position', async () => {
    const user = userEvent.setup();
    createCategory.mockResolvedValue(category('cat-new', 'Fuel', 'Chief'));
    renderAt('/finance/settings', '/finance/settings', FiscalYearSettingsPage);

    expect(screen.getByText('Owner: Training Officer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new category/i }));
    await user.type(screen.getByLabelText('Name'), 'Fuel');
    await screen.findByRole('option', { name: 'Chief' });
    await user.selectOptions(screen.getByLabelText('Owner position (optional)'), 'pos-chief');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createCategory).toHaveBeenCalledWith({ name: 'Fuel', ownerPositionId: 'pos-chief' }));
    expect(fetchBudgetCategories).toHaveBeenCalled();
  });

  it('clears a category owner on edit with null', async () => {
    const user = userEvent.setup();
    updateCategory.mockResolvedValue(category('cat-training', 'Training'));
    renderAt('/finance/settings', '/finance/settings', FiscalYearSettingsPage);

    await user.click(screen.getByRole('button', { name: 'Edit Training' }));
    const owner = screen.getByLabelText('Owner position (optional)');
    expect(owner).toHaveValue('pos-Training Officer');
    await user.selectOptions(owner, '');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateCategory).toHaveBeenCalledWith('cat-training', {
        name: 'Training',
        description: null,
        ownerPositionId: null,
      })
    );
  });
});
