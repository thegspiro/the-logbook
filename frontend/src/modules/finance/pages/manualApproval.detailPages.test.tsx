/**
 * Each request detail page offers manual approve/deny for a request waiting on
 * approval with no approval steps — and only then.
 *
 * The panel's own rules are tested beside it; this checks that each of the
 * three pages hands it the right request.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: () => storeState,
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../services/api', () => ({
  approvalService: { manualApprove: vi.fn(), manualDeny: vi.fn() },
  purchaseRequestService: {},
  expenseReportService: {},
  checkRequestService: {},
}));

import { useAuthStore } from '@/stores/authStore';
import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';
import ExpenseReportDetailPage from './ExpenseReportDetailPage';
import CheckRequestDetailPage from './CheckRequestDetailPage';

const PROMPT = 'No approval chain applies to this request. Approve or deny it here.';

const base = {
  id: 'rec-1',
  organizationId: 'org-1',
  fiscalYearId: 'fy-1',
  createdAt: '2026-09-01T12:00:00Z',
  updatedAt: '2026-09-01T12:00:00Z',
  status: 'pending_approval',
  approvalSteps: [] as unknown[],
};

const pendingStep = {
  id: 'step-1',
  chainId: 'chain-1',
  stepId: 's-1',
  entityType: 'purchase_request',
  entityId: 'rec-1',
  status: 'pending',
  stepName: 'Officer review',
  stepOrder: 1,
  createdAt: '2026-09-01T12:00:00Z',
};

const pages = [
  {
    name: 'purchase request',
    path: '/finance/purchase-requests/:id',
    url: '/finance/purchase-requests/rec-1',
    Page: PurchaseRequestDetailPage,
    state: (over: Record<string, unknown>) => ({
      selectedPurchaseRequest: {
        ...base,
        requestNumber: 'PR-2026-0001',
        requestedBy: 'requester-1',
        title: 'Hose couplings',
        estimatedAmount: '1200.00',
        priority: 'normal',
        ...over,
      },
      fetchPurchaseRequest: vi.fn(),
      submitPurchaseRequest: vi.fn(),
    }),
  },
  {
    name: 'expense report',
    path: '/finance/expenses/:id',
    url: '/finance/expenses/rec-1',
    Page: ExpenseReportDetailPage,
    state: (over: Record<string, unknown>) => ({
      selectedExpenseReport: {
        ...base,
        reportNumber: 'ER-2026-0001',
        submittedBy: 'requester-1',
        title: 'Conference travel',
        totalAmount: '300.00',
        lineItems: [],
        ...over,
      },
      fetchExpenseReport: vi.fn(),
      submitExpenseReport: vi.fn(),
    }),
  },
  {
    name: 'check request',
    path: '/finance/check-requests/:id',
    url: '/finance/check-requests/rec-1',
    Page: CheckRequestDetailPage,
    state: (over: Record<string, unknown>) => ({
      selectedCheckRequest: {
        ...base,
        requestNumber: 'CK-2026-0001',
        requestedBy: 'requester-1',
        payeeName: 'Acme Supply',
        amount: '450.00',
        ...over,
      },
      fetchCheckRequest: vi.fn(),
      submitCheckRequest: vi.fn(),
    }),
  },
];

describe.each(pages)('$name detail page', ({ path, url, Page, state }) => {
  const renderWith = (over: Record<string, unknown> = {}) => {
    storeState = { isLoading: false, error: null, ...state(over) };
    return render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={path} element={<Page />} />
        </Routes>
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'approver-1', permissions: ['finance.approve'] } as never });
  });

  it('offers manual approval when no approval chain applied', () => {
    renderWith();
    expect(screen.getByText(PROMPT)).toBeInTheDocument();
  });

  it('does not when the request has approval steps', () => {
    renderWith({ approvalSteps: [pendingStep] });
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });

  it('does not once the request is decided', () => {
    renderWith({ status: 'approved' });
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });
});
