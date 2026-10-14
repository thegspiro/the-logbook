/**
 * Workflow review W64: an approved expense report could not be recorded as
 * reimbursed. `POST /expense-reports/{id}/mark-paid` existed, with
 * `expenseReportService.markPaid` beside it, and no control called either.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { createMockApiError } from '@/test/utils';

const { storeState, permissions, markPaid, fetchExpenseReport, toastError, toastSuccess } = vi.hoisted(() => {
  const state: { current: Record<string, unknown> } = { current: {} };
  const granted: { current: string[] } = { current: [] };
  return {
    storeState: state,
    permissions: granted,
    markPaid: vi.fn(),
    fetchExpenseReport: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  };
});

vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState.current) : storeState.current,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => permissions.current.includes(p), user: { id: 'u-treasurer' } }),
}));

vi.mock('../services/api', () => ({
  expenseReportService: {
    markPaid: (...args: unknown[]) => markPaid(...args) as unknown,
  },
  functionalClassService: { setExpenseLine: vi.fn() },
}));

import ExpenseReportDetailPage from './ExpenseReportDetailPage';

const renderPage = (status: string) => {
  storeState.current = {
    selectedExpenseReport: {
      id: 'er-1',
      organizationId: 'org-1',
      fiscalYearId: 'fy-1',
      reportNumber: 'ER-2026-0001',
      title: 'State fire school',
      submittedBy: 'u-member',
      totalAmount: '165.20',
      status,
      lineItems: [],
      approvalSteps: [],
      createdAt: '2026-10-14T16:15:00Z',
      updatedAt: '2026-10-14T16:15:00Z',
    },
    isLoading: false,
    error: null,
    fetchExpenseReport,
    submitExpenseReport: vi.fn(),
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

describe('Mark Paid on an expense report (W64)', () => {
  beforeEach(() => {
    for (const mock of [markPaid, fetchExpenseReport, toastError, toastSuccess]) mock.mockReset();
    markPaid.mockResolvedValue({});
    permissions.current = ['finance.view', 'finance.manage'];
  });

  it('records an approved report as paid once confirmed, then reloads it', async () => {
    const user = userEvent.setup();
    renderPage('approved');

    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));
    expect(await screen.findByText(/Record ER-2026-0001 \(\$165\.20\) as reimbursed/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark as paid' }));

    await waitFor(() => expect(markPaid).toHaveBeenCalledWith('er-1'));
    expect(fetchExpenseReport).toHaveBeenCalledWith('er-1');
  });

  it('does nothing when the confirmation is declined', async () => {
    const user = userEvent.setup();
    renderPage('approved');

    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));
    await user.click(await screen.findByRole('button', { name: 'Not yet' }));

    expect(markPaid).not.toHaveBeenCalled();
  });

  it("shows the server's reason when it refuses", async () => {
    markPaid.mockRejectedValue(createMockApiError('You cannot mark paid an expense report you submitted', 403));
    const user = userEvent.setup();
    renderPage('approved');

    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));
    await user.click(await screen.findByRole('button', { name: 'Mark as paid' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('expense report you submitted'))
    );
  });

  it('is offered only to a finance manager, and only once approved', () => {
    renderPage('pending_approval');
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();
  });

  it('is not offered to a member', () => {
    permissions.current = ['finance.request'];
    renderPage('approved');
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();
  });
});
