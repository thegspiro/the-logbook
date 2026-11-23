/**
 * Editing a purchase request shows the budget line and fiscal year it is on.
 *
 * Both pickers fill from option lists that arrive after the request itself:
 * the budget lines are only asked for once the fiscal year is known. The
 * selects were uncontrolled, so the request's values were written into them
 * while they held only their placeholder, the browser fell back to that, and
 * nothing wrote the values again once the options came. A linked request
 * read "No budget linked".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const FISCAL_YEARS = [
  { id: 'fy-1', name: 'FY2026', status: 'active' },
  { id: 'fy-2', name: 'FY2027', status: 'draft' },
];
const BUDGET_LINES = [
  { id: 'b-1', label: 'Apparatus', amountRemaining: null, categoryActive: true },
  { id: 'b-2', label: 'Training', amountRemaining: null, categoryActive: true },
];

let fiscalYearsLoad = deferred<typeof FISCAL_YEARS>();
let budgetLinesLoad = deferred<typeof BUDGET_LINES>();

vi.mock('../services/api', () => ({
  fiscalYearService: { options: () => fiscalYearsLoad.promise },
  budgetService: { options: () => budgetLinesLoad.promise },
  purchaseRequestService: { update: vi.fn(), cancel: vi.fn() },
  fundService: { list: () => Promise.resolve([]) },
  approvalChainService: {
    routePreview: () => Promise.resolve({ manual: true, steps: [], secondApproverRequired: false }),
  },
  financeSettingsService: {
    get: () =>
      Promise.resolve({
        dualApprovalThreshold: null,
        substantiationMode: 'off',
        substantiationDays: 60,
        fundOverspendMode: 'warn',
      }),
  },
}));

import PurchaseRequestFormPage from './PurchaseRequestFormPage';

const renderEdit = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/finance/purchase-requests/pr-1/edit']}>
        <Routes>
          <Route path="/finance/purchase-requests/:id/edit" element={<PurchaseRequestFormPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

beforeEach(() => {
  fiscalYearsLoad = deferred<typeof FISCAL_YEARS>();
  budgetLinesLoad = deferred<typeof BUDGET_LINES>();
  storeState = {
    isLoading: false,
    fetchPurchaseRequest: vi.fn(),
    createPurchaseRequest: vi.fn(),
    // Submitted, so the form saves explicitly and no autosave runs.
    selectedPurchaseRequest: {
      id: 'pr-1',
      title: 'Hose replacement',
      description: '',
      vendor: '',
      estimatedAmount: '1200.00',
      priority: 'medium',
      status: 'submitted',
      budgetId: 'b-2',
      fundCampaignId: null,
      fiscalYearId: 'fy-2',
    },
  };
});

describe('editing a purchase request', () => {
  it('shows the fiscal year and budget line it is on once their options arrive', async () => {
    renderEdit();
    const fiscalYear = screen.getByRole<HTMLSelectElement>('combobox', { name: /Fiscal Year/ });
    const budget = screen.getByRole<HTMLSelectElement>('combobox', { name: /Budget/ });

    await act(async () => {
      fiscalYearsLoad.resolve(FISCAL_YEARS);
      await fiscalYearsLoad.promise;
    });
    await waitFor(() => expect(fiscalYear.value).toBe('fy-2'));

    await act(async () => {
      budgetLinesLoad.resolve(BUDGET_LINES);
      await budgetLinesLoad.promise;
    });
    await waitFor(() => expect(budget.value).toBe('b-2'));
    expect(budget.selectedOptions[0]?.textContent).toBe('Training');
  });
});
