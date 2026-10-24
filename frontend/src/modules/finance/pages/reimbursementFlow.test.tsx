/**
 * Purchase request -> expense report -> reimbursement check, on the screens.
 *
 * A member who bought an approved purchase themselves claims it back from the
 * request's page, which starts an expense report linked to it. The finance
 * office pays the approved report by check from the report's page; the check
 * goes through its own approval before it is issued. Every link and amount
 * shown is the server's (app/services/finance_reimbursement.py).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-10-20',
}));

const permissions = new Set<string>();
let userId = 'u-alice';
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => permissions.has(p), user: { id: userId } }),
}));

const mockClaim = vi.fn();
const mockPayByCheck = vi.fn();
vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    purchaseRequestService: {
      ...actual.purchaseRequestService,
      claimReimbursement: (...args: unknown[]) => mockClaim(...args) as unknown,
    },
    expenseReportService: {
      ...actual.expenseReportService,
      payByCheck: (...args: unknown[]) => mockPayByCheck(...args) as unknown,
    },
  };
});

import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';
import ExpenseReportDetailPage from './ExpenseReportDetailPage';
import CheckRequestDetailPage from './CheckRequestDetailPage';

const stamps = {
  organizationId: 'org-1',
  fiscalYearId: 'fy-1',
  createdAt: '2026-10-01T15:00:00Z',
  updatedAt: '2026-10-01T15:00:00Z',
  approvalSteps: [],
};

const purchase = (overrides: Record<string, unknown> = {}) => ({
  ...stamps,
  id: 'pr-1',
  requestNumber: 'PR-2026-0100',
  title: 'Hose nozzles',
  vendor: 'Fire Supply Co',
  requestedBy: 'u-alice',
  estimatedAmount: '200.00',
  priority: 'medium',
  status: 'approved',
  ...overrides,
});

const report = (overrides: Record<string, unknown> = {}) => ({
  ...stamps,
  id: 'er-1',
  reportNumber: 'ER-2026-0002',
  title: 'Hose nozzles',
  submittedBy: 'u-alice',
  totalAmount: '180.00',
  amountOwed: '180.00',
  status: 'approved',
  purchaseRequestId: 'pr-1',
  purchaseRequestNumber: 'PR-2026-0100',
  lineItems: [],
  ...overrides,
});

/** Renders the page at its route, with a stand-in for where it navigates. */
const renderPage = (path: string, route: string, Page: React.FC) =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={<Page />} />
          <Route path="/finance/expenses/:id" element={<p>Expense report page</p>} />
          <Route path="/finance/check-requests/:id" element={<p>Check request page</p>} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

const showPurchase = (entity: Record<string, unknown>) => {
  storeState = {
    selectedPurchaseRequest: entity,
    isLoading: false,
    error: null,
    fetchPurchaseRequest: vi.fn(),
  };
  renderPage('/finance/purchase-requests/pr-1', '/finance/purchase-requests/:id', PurchaseRequestDetailPage);
};

const showReport = (entity: Record<string, unknown>) => {
  storeState = {
    selectedExpenseReport: entity,
    isLoading: false,
    error: null,
    fetchExpenseReport: vi.fn(),
  };
  renderPage('/finance/expenses/er-1', '/finance/expenses/:id', ExpenseReportDetailPage);
};

describe('claiming a purchase back', () => {
  beforeEach(() => {
    mockClaim.mockReset();
    mockClaim.mockResolvedValue(report({ id: 'er-new', status: 'draft' }));
    permissions.clear();
    permissions.add('finance.request');
    userId = 'u-alice';
  });

  it('starts an expense report from what the member paid, then opens it', async () => {
    const user = userEvent.setup();
    showPurchase(purchase());

    await user.click(screen.getByRole('button', { name: /Request Reimbursement/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('What you paid')).toHaveValue(200);
    fireEvent.change(within(dialog).getByLabelText('What you paid'), { target: { value: '185.25' } });
    fireEvent.change(within(dialog).getByLabelText('Paid on'), { target: { value: '2026-10-18' } });
    await user.click(within(dialog).getByRole('button', { name: 'Start expense report' }));

    await waitFor(() => expect(mockClaim).toHaveBeenCalled());
    expect(mockClaim).toHaveBeenCalledWith('pr-1', {
      amount: '185.25',
      dateIncurred: '2026-10-18T12:00:00.000Z',
      merchant: 'Fire Supply Co',
    });
    expect(await screen.findByText('Expense report page')).toBeInTheDocument();
  });

  it('is not offered to the finance office for someone elses purchase', () => {
    permissions.add('finance.manage');
    userId = 'u-treasurer';
    showPurchase(purchase());

    expect(screen.queryByRole('button', { name: /Request Reimbursement/ })).not.toBeInTheDocument();
  });

  it('is not offered before approval', () => {
    showPurchase(purchase({ status: 'pending_approval' }));

    expect(screen.queryByRole('button', { name: /Request Reimbursement/ })).not.toBeInTheDocument();
  });

  it('links to the report already claiming it instead', () => {
    showPurchase(
      purchase({
        reimbursementReportId: 'er-1',
        reimbursementReportNumber: 'ER-2026-0002',
        reimbursementReportStatus: 'pending_approval',
      })
    );

    expect(screen.queryByRole('button', { name: /Request Reimbursement/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ER-2026-0002' })).toHaveAttribute('href', '/finance/expenses/er-1');
    expect(screen.getByText('(awaiting approval)')).toBeInTheDocument();
  });

  it('does not let the office pay or cancel a purchase a submitted report claims', () => {
    permissions.add('finance.manage');
    userId = 'u-treasurer';
    showPurchase(
      purchase({
        status: 'received',
        reimbursementReportId: 'er-1',
        reimbursementReportNumber: 'ER-2026-0002',
        reimbursementReportStatus: 'approved',
      })
    );

    expect(screen.queryByRole('button', { name: /Mark Paid/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel Request/ })).not.toBeInTheDocument();
  });

  it('reads Reimbursed once the report is paid', () => {
    showPurchase(purchase({ status: 'reimbursed', paidAt: '2026-10-20T15:00:00Z' }));

    expect(screen.getAllByText('Reimbursed').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Request Reimbursement/ })).not.toBeInTheDocument();
  });
});

describe('paying a report by check', () => {
  beforeEach(() => {
    mockPayByCheck.mockReset();
    mockPayByCheck.mockResolvedValue({ id: 'ck-1', requestNumber: 'CK-2026-0001' });
    permissions.clear();
    permissions.add('finance.manage');
    userId = 'u-treasurer';
  });

  it('raises the check for what is owed, then opens it', async () => {
    const user = userEvent.setup();
    showReport(report({ totalAmount: '180.00', amountOwed: '130.00' }));

    expect(screen.getByRole('link', { name: 'PR-2026-0100' })).toHaveAttribute(
      'href',
      '/finance/purchase-requests/pr-1'
    );
    await user.click(screen.getByRole('button', { name: /Pay by Check/ }));
    const dialog = screen.getByRole('dialog');
    // The amount is the server's: the total less what an advance covered.
    expect(within(dialog).getByText(/\$130\.00/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Mailing address/), '1 Main St');
    await user.click(within(dialog).getByRole('button', { name: 'Request check' }));

    await waitFor(() => expect(mockPayByCheck).toHaveBeenCalled());
    expect(mockPayByCheck).toHaveBeenCalledWith('er-1', { payeeAddress: '1 Main St', memo: undefined });
    expect(await screen.findByText('Check request page')).toBeInTheDocument();
  });

  it('offers neither payment while a check is already paying it', () => {
    showReport(
      report({
        reimbursementCheckId: 'ck-1',
        reimbursementCheckNumber: 'CK-2026-0001',
        reimbursementCheckStatus: 'pending_approval',
      })
    );

    expect(screen.queryByRole('button', { name: /Pay by Check/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark Paid/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CK-2026-0001' })).toHaveAttribute('href', '/finance/check-requests/ck-1');
  });

  it('is not offered when an advance already covered the whole report', () => {
    showReport(report({ amountOwed: '0.00' }));

    expect(screen.queryByRole('button', { name: /Pay by Check/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark Paid/ })).toBeInTheDocument();
  });

  it('is not offered to the member who filed it', () => {
    permissions.clear();
    permissions.add('finance.request');
    userId = 'u-alice';
    showReport(report());

    expect(screen.queryByRole('button', { name: /Pay by Check/ })).not.toBeInTheDocument();
  });
});

describe('the reimbursement check', () => {
  beforeEach(() => {
    permissions.clear();
    permissions.add('finance.manage');
    userId = 'u-treasurer';
  });

  const showCheck = (overrides: Record<string, unknown>) => {
    storeState = {
      selectedCheckRequest: {
        ...stamps,
        id: 'ck-1',
        requestNumber: 'CK-2026-0001',
        requestedBy: 'u-alice',
        payeeName: 'Alice Member',
        amount: '180.00',
        status: 'approved',
        ...overrides,
      },
      isLoading: false,
      error: null,
      fetchCheckRequest: vi.fn(),
    };
    renderPage('/finance/check-requests/ck-1', '/finance/check-requests/:id', CheckRequestDetailPage);
  };

  it('links to the report it pays and is not classified on its own', () => {
    showCheck({ expenseReportId: 'er-1', expenseReportNumber: 'ER-2026-0002' });

    expect(screen.getByRole('link', { name: 'ER-2026-0002' })).toHaveAttribute('href', '/finance/expenses/er-1');
    expect(screen.queryByText('Expense classification')).not.toBeInTheDocument();
  });

  it('leaves an ordinary check classifiable', () => {
    showCheck({ budgetId: 'b-1' });

    expect(screen.getByText('Expense classification')).toBeInTheDocument();
    expect(screen.queryByText('Reimburses')).not.toBeInTheDocument();
  });
});
