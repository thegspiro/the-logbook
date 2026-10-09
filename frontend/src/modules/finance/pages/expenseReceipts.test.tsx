/**
 * Receipts on the expense report detail page.
 *
 * Each line shows its receipt. On a draft the requester attaches, replaces or
 * removes one per line, and Submit stays disabled — with the reason beside it
 * — until every line has one. An approver reading a submitted report can
 * download a receipt but not change it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

const uploadReceipt = vi.fn();
const removeReceipt = vi.fn();
const getReceipt = vi.fn();
vi.mock('../services/api', () => ({
  expenseReportService: {
    uploadReceipt: (...args: unknown[]) => uploadReceipt(...args) as unknown,
    removeReceipt: (...args: unknown[]) => removeReceipt(...args) as unknown,
    getReceipt: (...args: unknown[]) => getReceipt(...args) as unknown,
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

const withReceipt = { hasReceipt: true, receiptFileName: 'hotel-folio.pdf' };

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [uploadReceipt, removeReceipt, getReceipt, fetchExpenseReport, submitExpenseReport]) {
    mock.mockReset();
  }
  uploadReceipt.mockResolvedValue(line('li-1', 'Hotel', withReceipt));
  removeReceipt.mockResolvedValue(undefined);
  getReceipt.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
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
    expect(screen.getByText('No receipt')).toBeInTheDocument();
  });

  it('lets Submit go once every line has one', () => {
    renderPage('draft', [line('li-1', 'Hotel', withReceipt)]);

    expect(screen.getByRole('button', { name: /Submit for Approval/ })).toBeEnabled();
    expect(screen.queryByText(/before submitting/)).not.toBeInTheDocument();
  });

  it('attaches the chosen file to its line and fetches the report again', async () => {
    const user = userEvent.setup();
    renderPage('draft', [line('li-2', 'Parking')]);
    const file = new File(['%PDF-1.4'], 'parking.pdf', { type: 'application/pdf' });

    await user.upload(screen.getByLabelText('Receipt file for Parking'), file);

    await waitFor(() => expect(uploadReceipt).toHaveBeenCalledWith('er-1', 'li-2', file));
    expect(fetchExpenseReport).toHaveBeenCalledWith('er-1');
    expect(toastSuccess).toHaveBeenCalledWith('Receipt attached to Parking');
  });

  it('shows the API’s refusal of a file', async () => {
    const user = userEvent.setup();
    uploadReceipt.mockRejectedValue(new Error('File type not allowed (detected: text/plain).'));
    renderPage('draft', [line('li-2', 'Parking')]);

    await user.upload(
      screen.getByLabelText('Receipt file for Parking'),
      new File(['x'], 'p.pdf', { type: 'application/pdf' })
    );

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('File type not allowed (detected: text/plain).'));
  });

  it('removes a receipt after confirming', async () => {
    const user = userEvent.setup();
    renderPage('draft', [line('li-1', 'Hotel', withReceipt)]);

    await user.click(screen.getByRole('button', { name: 'Remove the receipt for Hotel' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('cannot be submitted until this line has one again');
    await user.click(within(dialog).getByRole('button', { name: 'Remove receipt' }));

    await waitFor(() => expect(removeReceipt).toHaveBeenCalledWith('er-1', 'li-1'));
    expect(fetchExpenseReport).toHaveBeenCalledWith('er-1');
  });

  it('offers a member nothing to change on someone else’s draft', () => {
    userId = 'u-bob';
    renderPage('draft', [line('li-1', 'Hotel', withReceipt)]);

    expect(screen.queryByRole('button', { name: /Replace|Remove the receipt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit for Approval/ })).not.toBeInTheDocument();
  });
});

describe('a submitted report', () => {
  it('lets an approver download a receipt but not change it', async () => {
    const user = userEvent.setup();
    permissions = ['finance.approve'];
    userId = 'u-chief';
    renderPage('pending_approval', [line('li-1', 'Hotel', withReceipt)]);
    // jsdom has no object URLs; put back whatever was there afterwards so the
    // stand-ins cannot leak into a later test.
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    const createObjectURL = vi.fn(() => 'blob:receipt');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      expect(screen.queryByRole('button', { name: /Replace|Remove the receipt/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Download the receipt for Hotel' }));

      await waitFor(() => expect(getReceipt).toHaveBeenCalledWith('er-1', 'li-1'));
      expect(createObjectURL).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
    } finally {
      click.mockRestore();
      Object.assign(URL, original);
    }
  });

  it('marks a line submitted before receipts were required', () => {
    permissions = ['finance.manage'];
    renderPage('paid', [line('li-1', 'Hotel')]);

    expect(screen.getByText('No receipt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Attach receipt/ })).not.toBeInTheDocument();
  });
});
