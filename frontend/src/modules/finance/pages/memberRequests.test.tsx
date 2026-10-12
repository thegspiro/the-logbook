/**
 * Every member raises their own finance requests (`finance.request`).
 *
 * The pages say what the viewer is looking at — "My Purchase Requests" for a
 * member who sees only their own — and offer only the actions the API will
 * accept from them: "New …" to a requester or the finance office, never to a
 * plain `finance.view` holder (whose save the API refuses), and the finance
 * office's order / receive / pay / issue / void steps to `finance.manage`
 * alone. The forms pick a budget line by name and amount left, from the
 * options endpoint a member can read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
const ME = 'u-me';
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p), user: { id: ME } }),
}));

const fiscalYearOptions = vi.fn();
const budgetOptions = vi.fn();
vi.mock('../services/api', () => ({
  fiscalYearService: { options: () => fiscalYearOptions() as unknown },
  budgetService: { options: (fy: string) => budgetOptions(fy) as unknown },
  purchaseRequestService: {},
}));

import PurchaseRequestsPage from './PurchaseRequestsPage';
import ExpenseReportsPage from './ExpenseReportsPage';
import CheckRequestsPage from './CheckRequestsPage';
import PurchaseRequestFormPage from './PurchaseRequestFormPage';
import CheckRequestFormPage from './CheckRequestFormPage';
import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';
import CheckRequestDetailPage from './CheckRequestDetailPage';

const renderAt = (path: string, pattern: string, Page: React.FC) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={<Page />} />
      </Routes>
    </MemoryRouter>
  );

const emptyLists = {
  purchaseRequests: [],
  expenseReports: [],
  checkRequests: [],
  isLoading: false,
  error: null,
  fetchPurchaseRequests: vi.fn(),
  fetchExpenseReports: vi.fn(),
  fetchCheckRequests: vi.fn(),
};

interface ListCase {
  name: string;
  path: string;
  Page: React.FC;
  all: string;
  mine: string;
  button: string;
  /** Who reads every member's records here. */
  orgWide: string;
}

const listCases: ListCase[] = [
  {
    name: 'purchase requests',
    path: '/finance/purchase-requests',
    Page: PurchaseRequestsPage,
    all: 'Purchase Requests',
    mine: 'My Purchase Requests',
    button: 'New Purchase Request',
    orgWide: 'finance.view',
  },
  {
    name: 'expense reports',
    path: '/finance/expenses',
    Page: ExpenseReportsPage,
    all: 'Expense Reports',
    mine: 'My Expense Reports',
    button: 'New Expense Report',
    // Own-only for a finance.view holder too (FIN-5).
    orgWide: 'finance.manage',
  },
  {
    name: 'check requests',
    path: '/finance/check-requests',
    Page: CheckRequestsPage,
    all: 'Check Requests',
    mine: 'My Check Requests',
    button: 'New Check Request',
    orgWide: 'finance.view',
  },
];

describe.each(listCases)('$name list', (c) => {
  beforeEach(() => {
    vi.clearAllMocks();
    granted = new Set();
    storeState = { ...emptyLists };
  });

  it('is titled as the member’s own list and offers New to a requester', () => {
    granted = new Set(['finance.request']);
    renderAt(c.path, c.path, c.Page);

    expect(screen.getByRole('heading', { level: 1, name: c.mine })).toBeInTheDocument();
    expect(screen.getAllByText(c.button).length).toBeGreaterThan(0);
  });

  it('keeps the department-wide title for whoever reads every record', () => {
    granted = new Set(['finance.request', c.orgWide]);
    renderAt(c.path, c.path, c.Page);

    expect(screen.getByRole('heading', { level: 1, name: c.all })).toBeInTheDocument();
  });

  it('does not offer New to a finance.view holder who cannot raise one', () => {
    granted = new Set(['finance.view']);
    renderAt(c.path, c.path, c.Page);

    expect(screen.queryByText(c.button)).not.toBeInTheDocument();
  });
});

describe('request forms pick a budget line by name and amount left', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fiscalYearOptions.mockReset();
    budgetOptions.mockReset();
    granted = new Set(['finance.request']);
    fiscalYearOptions.mockResolvedValue([{ id: 'fy-1', name: 'FY2026', status: 'active' }]);
    budgetOptions.mockResolvedValue([
      { id: 'b-1', label: 'Training', amountRemaining: '1250.00' },
      { id: 'b-2', label: 'Apparatus (Station 2)', amountRemaining: '80.50' },
    ]);
    storeState = {
      isLoading: false,
      selectedPurchaseRequest: null,
      fetchPurchaseRequest: vi.fn(),
      createPurchaseRequest: vi.fn(),
      createCheckRequest: vi.fn(),
    };
  });

  it('on the purchase request form', async () => {
    renderAt('/finance/purchase-requests/new', '/finance/purchase-requests/new', PurchaseRequestFormPage);

    expect(await screen.findByRole('option', { name: 'Training — $1,250.00 remaining' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Apparatus (Station 2) — $80.50 remaining' })).toBeInTheDocument();
    // The active year is chosen for them, and its lines are what was asked for.
    expect(budgetOptions).toHaveBeenCalledWith('fy-1');
  });

  it('on the check request form', async () => {
    renderAt('/finance/check-requests/new', '/finance/check-requests/new', CheckRequestFormPage);

    expect(await screen.findByRole('option', { name: 'FY2026' })).toBeInTheDocument();
    expect(fiscalYearOptions).toHaveBeenCalled();
  });
});

describe('detail page actions follow who may take them', () => {
  const pr = {
    id: 'pr-1',
    organizationId: 'org-1',
    fiscalYearId: 'fy-1',
    requestNumber: 'PR-0001',
    title: 'Structure gloves',
    estimatedAmount: '50.00',
    priority: 'medium',
    createdAt: '2026-09-20T15:00:00Z',
    updatedAt: '2026-09-20T15:00:00Z',
    approvalSteps: [],
  };

  const renderPr = (status: string, requestedBy: string) => {
    storeState = {
      selectedPurchaseRequest: { ...pr, status, requestedBy },
      isLoading: false,
      error: null,
      fetchPurchaseRequest: vi.fn(),
      submitPurchaseRequest: vi.fn(),
    };
    renderAt('/finance/purchase-requests/pr-1', '/finance/purchase-requests/:id', PurchaseRequestDetailPage);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    granted = new Set(['finance.request']);
  });

  it('lets a member edit, submit and withdraw their own draft', () => {
    renderPr('draft', ME);

    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit for Approval/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel Request/ })).toBeInTheDocument();
  });

  it('offers a member nothing once their request is with the finance office', () => {
    renderPr('received', ME);

    expect(screen.queryByRole('button', { name: /Mark Paid/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel Request/ })).not.toBeInTheDocument();
  });

  it('offers a finance viewer nothing on somebody else’s draft', () => {
    granted = new Set(['finance.view', 'finance.request']);
    renderPr('draft', 'u-someone-else');

    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit for Approval/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel Request/ })).not.toBeInTheDocument();
  });

  it('still gives the finance office its steps', () => {
    granted = new Set(['finance.view', 'finance.manage']);
    renderPr('received', 'u-someone-else');

    expect(screen.getByRole('button', { name: /Mark Paid/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel Request/ })).toBeInTheDocument();
  });

  it('keeps Issue Check from a member, and Void off an unissued check', () => {
    storeState = {
      selectedCheckRequest: {
        ...pr,
        id: 'cr-1',
        requestNumber: 'CR-0001',
        payeeName: 'Hose Co',
        amount: '75.00',
        status: 'approved',
        requestedBy: ME,
      },
      isLoading: false,
      error: null,
      fetchCheckRequest: vi.fn(),
      submitCheckRequest: vi.fn(),
    };
    renderAt('/finance/check-requests/cr-1', '/finance/check-requests/:id', CheckRequestDetailPage);

    expect(screen.queryByRole('button', { name: /Issue Check/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Void/ })).not.toBeInTheDocument();
  });
});
