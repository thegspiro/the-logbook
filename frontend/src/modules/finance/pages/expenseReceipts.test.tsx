/**
 * The receipt requirement on the expense report detail page.
 *
 * Every line needs an uploaded receipt (`receiptDocumentId`) before the
 * report can be submitted: Submit stays disabled — with the reason beside it —
 * until each line has one. Attaching and downloading are `ReceiptControl`'s,
 * covered by its own tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { ExpenseLineItem } from '../types';

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

let permissions: string[] = [];
let userId = 'u-alice';
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => permissions.includes(p), user: { id: userId } }),
}));

const uploadLineItemReceipt = vi.fn();
const downloadLineItemReceipt = vi.fn();
vi.mock('../services/api', () => ({
  expenseReportService: {
    uploadLineItemReceipt: (...args: unknown[]) => uploadLineItemReceipt(...args) as unknown,
    downloadLineItemReceipt: (...args: unknown[]) => downloadLineItemReceipt(...args) as unknown,
  },
}));

import ExpenseReportDetailPage from './ExpenseReportDetailPage';

const line = (id: string, description: string, extra: Partial<ExpenseLineItem> = {}): ExpenseLineItem => ({
  id,
  expenseReportId: 'er-1',
  description,
  amount: '50.00',
  dateIncurred: '2026-03-01T00:00:00Z',
  expenseType: 'travel',
  createdAt: '2026-03-02T00:00:00Z',
  ...extra,
});

const fetchExpenseReport = vi.fn();
const submitExpenseReport = vi.fn();

const renderPage = (status: string, lineItems: ExpenseLineItem[]) => {
  storeState = {
    selectedExpenseReport: {
      id: 'er-1',
      organizationId: 'org-1',
      fiscalYearId: 'fy-1',
      reportNumber: 'ER-2026-0007',
      title: 'Conference',
      submittedBy: 'u-alice',
      totalAmount: '100.00',
      status,
      lineItems,
      approvalSteps: [],
      createdAt: '2026-03-02T00:00:00Z',
      updatedAt: '2026-03-02T00:00:00Z',
    },
    isLoading: false,
    error: null,
    fetchExpenseReport,
    submitExpenseReport,
  };
  return render(
    <MemoryRouter initialEntries={['/finance/expenses/er-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/finance/expenses/:id" element={<ExpenseReportDetailPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
};

const withReceipt = {
  receiptDocumentId: 'doc-1',
  receiptFileUrl: '/api/v1/finance/expense-reports/er-1/items/li-1/receipt',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [uploadLineItemReceipt, downloadLineItemReceipt, fetchExpenseReport, submitExpenseReport]) {
    mock.mockReset();
  }
  uploadLineItemReceipt.mockResolvedValue(line('li-2', 'Parking', withReceipt));
  submitExpenseReport.mockResolvedValue(undefined);
  permissions = ['finance.request'];
  userId = 'u-alice';
});

describe('a draft report', () => {
  it('holds Submit until every line has a receipt, and says why', () => {
    renderPage('draft', [line('li-1', 'Hotel', withReceipt), line('li-2', 'Parking')]);

    const submit = screen.getByRole('button', { name: /Submit for Approval/ });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription('Attach a receipt to the remaining line before submitting.');
  });

  it('counts every line still missing one', () => {
    renderPage('draft', [line('li-1', 'Hotel'), line('li-2', 'Parking')]);

    expect(screen.getByRole('button', { name: /Submit for Approval/ })).toHaveAccessibleDescription(
      'Attach a receipt to 2 lines before submitting.'
    );
  });

  it('lets Submit go once every line has one', async () => {
    const user = userEvent.setup();
    renderPage('draft', [line('li-1', 'Hotel', withReceipt)]);

    const submit = screen.getByRole('button', { name: /Submit for Approval/ });
    expect(submit).toBeEnabled();
    expect(screen.queryByText(/before submitting/)).not.toBeInTheDocument();
    await user.click(submit);
    await waitFor(() => expect(submitExpenseReport).toHaveBeenCalledWith('er-1'));
  });

  it('attaches a receipt to the line it belongs to, then fetches again', async () => {
    const user = userEvent.setup();
    renderPage('draft', [line('li-2', 'Parking')]);
    const file = new File(['%PDF-1.4'], 'parking.pdf', { type: 'application/pdf' });

    await user.upload(screen.getByLabelText('Attach receipt for Parking'), file);

    await waitFor(() => expect(uploadLineItemReceipt).toHaveBeenCalledWith('er-1', 'li-2', file));
    await waitFor(() => expect(fetchExpenseReport).toHaveBeenCalledWith('er-1'));
  });
});

describe('a submitted report', () => {
  it('shows no requirement once the report has left draft', () => {
    permissions = ['finance.approve'];
    userId = 'u-chief';
    renderPage('pending_approval', [line('li-1', 'Hotel')]);

    expect(screen.queryByText(/before submitting/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit for Approval/ })).not.toBeInTheDocument();
  });
});
