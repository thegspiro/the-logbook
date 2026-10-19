/**
 * Workflow review W61: the Budgets list.
 *
 * - An overspent line read "100% used · Near limit" here while its own page
 *   said "Over budget": the list summed the bar's capped widths.
 * - Each row's chevron link had no accessible name.
 * - The totals row's Remaining was green even when the lines were overdrawn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Budget, BudgetCategory, FiscalYear } from '../types';

const { storeState } = vi.hoisted(() => {
  const state: { current: Record<string, unknown> } = { current: {} };
  return { storeState: state };
});

vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState.current) : storeState.current,
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => p === 'finance.view', user: { id: 'u-me' } }),
}));

import BudgetsPage from './BudgetsPage';

const fiscalYear: FiscalYear = {
  id: 'fy-1',
  organizationId: 'org',
  name: 'FY2026',
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-12-31T00:00:00Z',
  status: 'active',
  isLocked: false,
  createdBy: 'u-t',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const category: BudgetCategory = {
  id: 'cat-gear',
  organizationId: 'org',
  name: 'Gear',
  sortOrder: 0,
  isActive: true,
  ownerPositionId: null,
  ownerPositionName: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const overspent: Budget = {
  id: 'b-gear',
  organizationId: 'org',
  fiscalYearId: 'fy-1',
  categoryId: 'cat-gear',
  categoryName: 'Gear',
  amountBudgeted: '1000.00',
  amountSpent: '1200.00',
  amountEncumbered: '100.00',
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
};

const renderList = () =>
  render(
    <MemoryRouter>
      <BudgetsPage />
    </MemoryRouter>
  );

describe('BudgetsPage list (W61)', () => {
  beforeEach(() => {
    storeState.current = {
      fiscalYears: [fiscalYear],
      budgets: [overspent],
      budgetCategories: [category],
      isLoading: false,
      error: null,
      fetchFiscalYears: vi.fn(),
      fetchBudgets: vi.fn(),
      fetchBudgetCategories: vi.fn(),
    };
  });

  it('reports an overspent line as over budget, with its real percentage', () => {
    renderList();
    expect(screen.getByText('130% used')).toBeInTheDocument();
    expect(screen.getByText('Over budget')).toBeInTheDocument();
    expect(screen.queryByText('Near limit')).not.toBeInTheDocument();
  });

  it('names the row link after the line it opens', () => {
    renderList();
    expect(screen.getByRole('link', { name: 'Open Gear' })).toHaveAttribute('href', '/finance/budgets/b-gear');
    // Both links into the line were 16px tall at 390px wide.
    expect(screen.getByRole('link', { name: 'Open Gear' })).toHaveClass('touch-target-phone');
    expect(screen.getByRole('link', { name: 'Gear' })).toHaveClass('touch:min-h-11');
  });

  it('shows an overdrawn total in red', () => {
    renderList();
    const totals = screen.getByRole('row', { name: /^Total/ });
    expect(within(totals).getByText('-$300')).toHaveClass('text-red-600');
  });
});
