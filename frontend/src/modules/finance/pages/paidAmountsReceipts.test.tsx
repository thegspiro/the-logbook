/**
 * Owner decisions of 2026-11-01 on paying finance requests.
 *
 * - "Mark Paid" asks what was actually paid, and the paid request shows the
 *   server's difference from the approved amount.
 * - No payment without a receipt: Mark Paid and Issue Check wait for one and
 *   say so, except on an advance or a reimbursement check.
 * - The member picks each expense's budget line; approval commits it there.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { createMockApiError } from '@/test/utils';

const { storeState, markPaid, issue, addLine, fetchPurchaseRequest, fetchCheckRequest } = vi.hoisted(() => {
  const current: Record<string, unknown> = {};
  return {
    storeState: { current },
    markPaid: vi.fn(),
    issue: vi.fn(),
    addLine: vi.fn(),
    fetchPurchaseRequest: vi.fn(),
    fetchCheckRequest: vi.fn(),
  };
});

vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState.current) : storeState.current,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({
      checkPermission: (p) => ['finance.view', 'finance.manage'].includes(p),
      user: { id: 'u-treasurer' },
    }),
}));
vi.mock('../hooks/useFundOptions', () => ({ useFundOptions: () => ({ funds: [], mode: 'warn' }) }));
vi.mock('../hooks/useLateLineWarning', () => ({ useLateLineWarning: () => () => null }));
vi.mock('../services/api', () => ({
  // The detail pages ask whether the payment went to QuickBooks Online; it did not.
  quickBooksOnlineService: { postings: () => Promise.resolve([]) },
  approvalService: { manualApprove: vi.fn(), manualDeny: vi.fn() },
  functionalClassService: {},
  advanceService: { get: vi.fn(), deleteReturn: vi.fn() },
  purchaseRequestService: {
    markPaid: (...args: unknown[]) => markPaid(...args) as unknown,
    uploadReceipt: vi.fn(),
    downloadReceipt: vi.fn(),
  },
  checkRequestService: {
    issue: (...args: unknown[]) => issue(...args) as unknown,
    void: vi.fn(),
    uploadReceipt: vi.fn(),
    downloadReceipt: vi.fn(),
  },
  expenseReportService: {
    addLineItem: (...args: unknown[]) => addLine(...args) as unknown,
    updateLineItem: vi.fn(),
  },
  fiscalYearService: { options: () => Promise.resolve([]) },
  // The line dialog reads the mileage rate for its trip log.
  financeSettingsService: { get: () => Promise.reject(new Error('not needed')) },
  budgetService: {
    options: () =>
      Promise.resolve([
        { id: 'line-training', label: 'Training', amountRemaining: null, categoryActive: true },
        { id: 'line-fuel', label: 'Fuel', amountRemaining: null, categoryActive: true },
      ]),
  },
}));

import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';
import CheckRequestDetailPage from './CheckRequestDetailPage';
import { ExpenseLineDialog } from '../components/ExpenseLineDialog';

const purchase = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr-1',
  organizationId: 'org-1',
  fiscalYearId: 'fy-1',
  requestNumber: 'PR-0001',
  title: 'Hose nozzles',
  requestedBy: 'u-member',
  estimatedAmount: '200.00',
  priority: 'medium',
  status: 'received',
  receiptDocumentId: 'doc-1',
  receiptFileUrl: '/api/v1/finance/purchase-requests/pr-1/receipt',
  approvalSteps: [],
  createdAt: '2026-10-14T16:52:00Z',
  updatedAt: '2026-10-14T16:52:00Z',
  ...overrides,
});

const check = (overrides: Record<string, unknown> = {}) => ({
  id: 'cr-1',
  organizationId: 'org-1',
  fiscalYearId: 'fy-1',
  requestNumber: 'CK-2026-0001',
  payeeName: 'County Fuel Depot',
  amount: '60.00',
  status: 'approved',
  requestedBy: 'u-member',
  receiptRequired: true,
  approvalSteps: [],
  createdAt: '2026-10-14T16:52:00Z',
  updatedAt: '2026-10-14T16:52:00Z',
  ...overrides,
});

const renderPurchase = (overrides: Record<string, unknown> = {}) => {
  storeState.current = {
    selectedPurchaseRequest: purchase(overrides),
    isLoading: false,
    error: null,
    fetchPurchaseRequest,
    submitPurchaseRequest: vi.fn(),
  };
  return render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/finance/purchase-requests/pr-1']}>
        <Routes>
          <Route path="/finance/purchase-requests/:id" element={<PurchaseRequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );
};

const renderCheck = (overrides: Record<string, unknown> = {}) => {
  storeState.current = {
    selectedCheckRequest: check(overrides),
    isLoading: false,
    error: null,
    fetchCheckRequest,
    submitCheckRequest: vi.fn(),
  };
  return render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/finance/check-requests/cr-1']}>
        <Routes>
          <Route path="/finance/check-requests/:id" element={<CheckRequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );
};

describe('Mark Paid asks what was paid', () => {
  beforeEach(() => {
    markPaid.mockReset();
    markPaid.mockResolvedValue(purchase({ status: 'paid' }));
    fetchPurchaseRequest.mockReset();
  });

  it('sends the amount entered, starting from the approved estimate', async () => {
    const user = userEvent.setup();
    renderPurchase();

    await user.click(screen.getByRole('button', { name: /Mark Paid/ }));
    const dialog = screen.getByRole('dialog');
    const field = within(dialog).getByLabelText('Amount paid');
    expect(field).toHaveValue(200);
    expect(dialog).toHaveTextContent('approved for $200.00');

    await user.clear(field);
    await user.type(field, '230');
    await user.click(within(dialog).getByRole('button', { name: 'Mark paid' }));

    await waitFor(() => expect(markPaid).toHaveBeenCalledWith('pr-1', '230.00'));
    await waitFor(() => expect(fetchPurchaseRequest).toHaveBeenCalledWith('pr-1'));
  });

  it("shows the server's refusal in the dialog", async () => {
    markPaid.mockRejectedValue(
      createMockApiError('Attach the receipt or invoice to this purchase request before it is marked paid.', 400)
    );
    const user = userEvent.setup();
    renderPurchase();

    await user.click(screen.getByRole('button', { name: /Mark Paid/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark paid' }));

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Attach the receipt');
  });

  it('shows the difference the server reports once paid', () => {
    renderPurchase({ status: 'paid', actualAmount: '230.00', paidDifference: '30.00' });

    expect(screen.getByText('Amount Paid')).toBeInTheDocument();
    expect(screen.getByText('$230.00')).toBeInTheDocument();
    expect(screen.getByText('Difference from Approved')).toBeInTheDocument();
    expect(screen.getByText('$30.00 over')).toBeInTheDocument();
  });

  it('reads an underpayment as under', () => {
    renderPurchase({ status: 'paid', actualAmount: '185.50', paidDifference: '-14.50' });
    expect(screen.getByText('$14.50 under')).toBeInTheDocument();
  });
});

describe('A receipt before payment', () => {
  beforeEach(() => {
    issue.mockReset();
    issue.mockResolvedValue({});
  });

  it('holds Mark Paid until the purchase has a receipt, and says why', () => {
    renderPurchase({ receiptDocumentId: null, receiptFileUrl: null });

    const button = screen.getByRole('button', { name: /Mark Paid/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Attach the receipt or invoice below before marking this request paid/);
  });

  it('holds Issue Check until the check has a receipt, and offers the upload', () => {
    renderCheck();

    const button = screen.getByRole('button', { name: /Issue Check/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Attach the receipt or invoice before issuing this check/);
    expect(screen.getByText('Receipt or invoice')).toBeInTheDocument();
  });

  it('lets a check with its receipt be issued', () => {
    renderCheck({ receiptDocumentId: 'doc-1', receiptFileUrl: '/api/v1/finance/check-requests/cr-1/receipt' });
    expect(screen.getByRole('button', { name: /Issue Check/ })).toBeEnabled();
  });

  it('does not hold an advance, whose receipts come on its expense report', () => {
    renderCheck({ isAdvance: true, receiptRequired: false });
    expect(screen.getByRole('button', { name: /Issue Check/ })).toBeEnabled();
    expect(screen.queryByText('Receipt or invoice')).not.toBeInTheDocument();
  });
});

describe('The member picks the budget line', () => {
  beforeEach(() => {
    addLine.mockReset();
    addLine.mockResolvedValue({});
  });

  it('offers the year’s lines and sends the one chosen', async () => {
    const user = userEvent.setup();
    render(<ExpenseLineDialog reportId="er-1" fiscalYearId="fy-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText('Description *'), 'Registration');
    await user.type(screen.getByLabelText('Amount *'), '45');
    const picker = screen.getByLabelText('Budget line');
    await screen.findByRole('option', { name: 'Training' });
    await user.selectOptions(picker, 'line-training');
    expect(picker).toHaveAccessibleDescription('Approving the report commits this amount to the line you choose.');
    await user.click(screen.getByRole('button', { name: 'Add line' }));

    await waitFor(() =>
      expect(addLine).toHaveBeenCalledWith('er-1', expect.objectContaining({ budgetId: 'line-training' }))
    );
  });

  it('sends no line when none is chosen', async () => {
    const user = userEvent.setup();
    render(<ExpenseLineDialog reportId="er-1" fiscalYearId="fy-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText('Description *'), 'Coffee');
    await user.type(screen.getByLabelText('Amount *'), '4');
    await user.click(screen.getByRole('button', { name: 'Add line' }));

    await waitFor(() => expect(addLine).toHaveBeenCalled());
    expect(addLine.mock.calls[0]?.[1]).not.toHaveProperty('budgetId');
  });
});
