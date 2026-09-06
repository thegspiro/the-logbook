/**
 * The expense reports list renders its trail, at its own route, in both states.
 *
 * `breadcrumbs.test.tsx` beside this one proves the component is *written* into
 * every branch. It cannot prove the trail survives to the screen: the crumb for
 * this page comes from `BREADCRUMB_ROUTES`, and the trail is derived from the
 * URL, so a source scan would keep passing if either broke.
 *
 * Both states are rendered because the loading branch is the half that was
 * missing on four sibling pages, and the state is chosen explicitly rather than
 * inherited from whatever the previous test left in the store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router';

const fetchExpenseReports = vi.fn();
let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: () => storeState,
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const checkPermission = vi.fn();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (...a: unknown[]) => checkPermission(...a) as boolean }),
}));

import ExpenseReportsPage from './ExpenseReportsPage';

const renderAt = () => {
  window.history.replaceState({}, '', '/finance/expenses');
  return render(
    <BrowserRouter>
      <ExpenseReportsPage />
    </BrowserRouter>
  );
};

const trail = () => screen.getByRole('navigation', { name: /breadcrumb/i });

describe('ExpenseReportsPage breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the implementation, not just the calls: a mockReturnValue set by one
    // block outlives clearAllMocks (CLAUDE.md pitfall #28).
    checkPermission.mockReset();
    checkPermission.mockReturnValue(true);
    storeState = { expenseReports: [], isLoading: false, error: null, fetchExpenseReports };
  });

  it('names the page the way its heading does, not the way the URL segment reads', () => {
    // The segment is "expenses"; the page, its detail page's back link and the
    // testing registry all call it Expense Reports.
    renderAt();

    expect(within(trail()).getByText('Expense Reports')).toBeInTheDocument();
    expect(within(trail()).queryByText('Expenses')).not.toBeInTheDocument();
  });

  it('offers Finance as a way up for a viewer whose grants open it', () => {
    renderAt();

    expect(within(trail()).getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/finance');
  });

  it('leaves Finance unlinked for a viewer who cannot open it', () => {
    // /finance is finance.view-gated, and a crumb that leads to Access Denied is
    // worse than one that is plain text.
    checkPermission.mockReturnValue(false);
    renderAt();

    expect(within(trail()).queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
    expect(within(trail()).getByText('Finance')).toBeInTheDocument();
  });

  it('still renders the trail while the list is loading', () => {
    // The branch four sibling finance pages were missing it from.
    storeState = { expenseReports: [], isLoading: true, error: null, fetchExpenseReports };
    renderAt();

    expect(trail()).toBeInTheDocument();
    expect(within(trail()).getByText('Expense Reports')).toBeInTheDocument();
  });
});
