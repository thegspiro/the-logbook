/**
 * Deleting a budget category that anything uses deactivates it instead.
 *
 * The confirmation used to promise that the category's budget lines in every
 * fiscal year would be deleted with it, and a refusal of any kind read
 * "Failed to delete category". The backend now deactivates a category that
 * lines, requests or approval chains use, and says which it did; the screen
 * words both outcomes, reports the one that happened, and passes the server's
 * reason through on a failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { BudgetCategory } from '../types';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

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
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: () => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: () => true, user: { id: 'u-me' } }),
}));

const deleteCategory = vi.fn();
vi.mock('../services/api', () => ({
  budgetCategoryService: {
    create: vi.fn(),
    update: vi.fn(),
    delete: (...args: unknown[]) => deleteCategory(...args) as unknown,
  },
  fiscalYearService: { lock: vi.fn() },
  financeOptionService: {
    positions: () => Promise.resolve([]),
    stations: () => Promise.resolve([]),
  },
}));

import FiscalYearSettingsPage from './FiscalYearSettingsPage';

const category = (id: string, name: string, isActive = true): BudgetCategory => ({
  id,
  organizationId: 'org',
  name,
  sortOrder: 0,
  isActive,
  ownerPositionId: null,
  ownerPositionName: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const fetchBudgetCategories = vi.fn();

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConfirmProvider>
        <FiscalYearSettingsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

const confirmDelete = async (name: string) => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole('button', { name: `Delete ${name}` }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
};

describe('FiscalYearSettingsPage category delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteCategory.mockReset();
    deleteCategory.mockResolvedValue('deleted');
    fetchBudgetCategories.mockReset();
    storeState = {
      fiscalYears: [],
      budgets: [],
      budgetCategories: [category('cat-gear', 'Gear'), category('cat-old', 'Old Uniforms', false)],
      isLoading: false,
      error: null,
      fetchFiscalYears: vi.fn(),
      fetchBudgets: vi.fn(),
      fetchBudgetCategories,
    };
  });

  it('says a category in use is deactivated rather than deleted', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Delete Gear' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/Delete "Gear"\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/it is deactivated instead of deleted/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/budgets in every fiscal year are deleted too/)).not.toBeInTheDocument();
  });

  it('reports a deactivation as one', async () => {
    deleteCategory.mockResolvedValue('deactivated');
    await confirmDelete('Gear');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(deleteCategory).toHaveBeenCalledWith('cat-gear');
    expect(toastSuccess.mock.calls[0]?.[0]).toMatch(/Gear is still used .* deactivated instead of deleted/);
    expect(fetchBudgetCategories).toHaveBeenCalled();
  });

  it('reports a deletion as one', async () => {
    await confirmDelete('Gear');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Category deleted'));
  });

  it("shows the server's reason when the delete fails", async () => {
    deleteCategory.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { status: 400, data: { detail: 'Budget category not found' } },
    });
    await confirmDelete('Gear');

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]?.[0]).toContain('Budget category not found');
  });

  it('marks a deactivated category as inactive in the list', () => {
    renderPage();

    // Only the deactivated one carries the badge, and it sits on that row.
    expect(within(screen.getByText('Old Uniforms')).getByText('Inactive')).toBeInTheDocument();
    expect(screen.getAllByText('Inactive')).toHaveLength(1);
  });
});

/**
 * A deactivated parent closes its sub-categories to new charges (backend
 * CategoryTree.inactive_source). The list says a sub-category is inactive
 * through its parent, using the backend's inactiveThrough rather than
 * re-deriving it, and the delete confirmation warns before a parent with
 * sub-categories is deactivated.
 */
describe('FiscalYearSettingsPage inactive parent categories', () => {
  const apparatus = category('cat-app', 'Apparatus', false);
  const pump: BudgetCategory = {
    ...category('cat-pump', 'Pump repairs'),
    parentCategoryId: 'cat-app',
    inactiveThrough: 'Apparatus',
  };
  const training = category('cat-train', 'Training');

  beforeEach(() => {
    vi.clearAllMocks();
    deleteCategory.mockReset();
    deleteCategory.mockResolvedValue('deactivated');
    fetchBudgetCategories.mockReset();
    storeState = {
      fiscalYears: [],
      budgets: [],
      budgetCategories: [apparatus, pump, training],
      isLoading: false,
      error: null,
      fetchFiscalYears: vi.fn(),
      fetchBudgets: vi.fn(),
      fetchBudgetCategories,
    };
  });

  it('marks a sub-category as inactive through its inactive parent', () => {
    renderPage();

    expect(within(screen.getByText('Pump repairs')).getByText('Inactive through Apparatus')).toBeInTheDocument();
    expect(within(screen.getByText('Apparatus')).getByText('Inactive')).toBeInTheDocument();
    expect(within(screen.getByText('Training')).queryByText(/Inactive/)).not.toBeInTheDocument();
  });

  it("warns that a parent's sub-categories stop taking new charges", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Delete Apparatus' }));
    const dialog = await screen.findByRole('dialog');

    expect(
      within(dialog).getByText(/Its sub-categories' budget lines also stop taking new charges while it is inactive\./)
    ).toBeInTheDocument();
  });

  it('says nothing about sub-categories for a category with none', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Delete Training' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/Delete "Training"\?/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/sub-categories/)).not.toBeInTheDocument();
  });

  it('repeats the sub-category consequence when a parent is deactivated', async () => {
    await confirmDelete('Apparatus');

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0]?.[0]).toMatch(/Its sub-categories' budget lines also stop taking new charges\./);
  });
});
