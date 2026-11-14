/**
 * A 422 on the purchase, check and expense request forms lands under the
 * field it names, in that field's own words, and is announced with it (forms
 * review F-2/F-4) — not as a toast naming the API key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) as unknown },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: () => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: () => false, user: { id: 'u-1' } }),
}));
// One object for every render: the forms re-seed their year whenever the list changes.
const formOptions = {
  fiscalYears: [{ id: 'fy-1', name: 'FY2026', status: 'active' }],
  budgetOptions: [],
  fiscalYearsLoaded: true,
};
vi.mock('../hooks/useRequestFormOptions', () => ({
  useRequestFormOptions: () => formOptions,
  budgetOptionLabel: (option: { categoryName: string }) => option.categoryName,
  selectableBudgetOptions: (options: unknown[]) => options,
}));
const fundOptions = { funds: [], mode: 'warn' };
vi.mock('../hooks/useFundOptions', () => ({ useFundOptions: () => fundOptions }));
vi.mock('../services/api', () => ({
  advanceService: { list: () => Promise.resolve([]), holders: () => Promise.resolve([]) },
  financeSettingsService: { get: () => Promise.reject(new Error('not needed')) },
  approvalChainService: { routePreview: () => Promise.reject(new Error('not needed')) },
  purchaseRequestService: { update: vi.fn(), cancel: vi.fn() },
}));

import PurchaseRequestFormPage from './PurchaseRequestFormPage';
import CheckRequestFormPage from './CheckRequestFormPage';
import ExpenseReportFormPage from './ExpenseReportFormPage';

const refusal = (field: string, message = 'Value is too long.') => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});

const renderAt = (path: string, element: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfirmProvider>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  toastError.mockReset();
  sessionStorage.clear();
});

describe('purchase request', () => {
  beforeEach(() => {
    storeState = {
      isLoading: false,
      selectedPurchaseRequest: null,
      fetchPurchaseRequest: vi.fn(),
      createPurchaseRequest: vi.fn().mockRejectedValue(refusal('title')),
    };
  });

  it("puts the server's refusal of the title under the title", async () => {
    const user = userEvent.setup();
    renderAt('/finance/purchase-requests/new', <PurchaseRequestFormPage />);
    await user.type(screen.getByLabelText(/^Title/), 'Ladder');
    const amount = screen.getByLabelText(/^Estimated Amount/);
    await user.clear(amount);
    await user.type(amount, '400');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    const title = screen.getByLabelText(/^Title/);
    await waitFor(() => expect(title).toHaveAttribute('aria-invalid', 'true'));
    expect(title).toHaveAccessibleDescription('Title is too long — keep it to 300 characters.');
    expect(title).toHaveAttribute('maxLength', '300');
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('check request', () => {
  beforeEach(() => {
    storeState = { createCheckRequest: vi.fn().mockRejectedValue(refusal('payee_name')) };
  });

  it("puts the server's refusal of the payee under the payee", async () => {
    const user = userEvent.setup();
    renderAt('/finance/check-requests/new', <CheckRequestFormPage />);
    await user.type(screen.getByLabelText(/^Payee Name/), 'Acme Hose Co.');
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '250' } });
    await user.selectOptions(screen.getByLabelText(/^Fiscal Year/), 'fy-1');
    await user.click(screen.getByRole('button', { name: 'Create Check Request' }));

    const payee = screen.getByLabelText(/^Payee Name/);
    await waitFor(() => expect(payee).toHaveAttribute('aria-invalid', 'true'));
    expect(payee).toHaveAccessibleDescription('Payee Name is too long — keep it to 300 characters.');
    expect(payee).toHaveFocus();
  });
});

describe('expense report', () => {
  beforeEach(() => {
    storeState = { createExpenseReport: vi.fn().mockRejectedValue(refusal('line_items.0.description')) };
  });

  it("puts the server's refusal of a line's description on that line", async () => {
    const user = userEvent.setup();
    renderAt('/finance/expenses/new', <ExpenseReportFormPage />);
    await user.type(screen.getByLabelText(/^Title/), 'Conference');
    await user.click(screen.getByRole('button', { name: /Add Item/ }));
    const description = screen.getByLabelText(/^Description \*/);
    await user.type(description, 'Hotel');
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-01' } });
    await user.click(screen.getByRole('button', { name: 'Create Report' }));

    await waitFor(() => expect(description).toHaveAttribute('aria-invalid', 'true'));
    expect(description).toHaveAccessibleDescription('Description is too long — keep it to 500 characters.');
    expect(description).toHaveFocus();
  });
});
