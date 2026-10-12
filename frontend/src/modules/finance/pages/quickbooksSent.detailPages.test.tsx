/**
 * The request detail pages say when a payment went to QuickBooks.
 *
 * The export stamps each payment it carries (`qbExportedAt`) and leaves it out
 * of the next one, and a check voided after it was sent gets a reversing entry
 * (`qbVoidExportedAt`). The pages only report those dates; the backend decides
 * them.
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
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => p === 'finance.manage' }),
}));

import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';
import ExpenseReportDetailPage from './ExpenseReportDetailPage';
import CheckRequestDetailPage from './CheckRequestDetailPage';

const base = {
  id: 'e-1',
  organizationId: 'org-1',
  fiscalYearId: 'fy-1',
  createdAt: '2026-03-01T15:00:00Z',
  updatedAt: '2026-03-01T15:00:00Z',
  approvalSteps: [],
};

interface PageCase {
  name: string;
  path: string;
  Page: React.FC;
  selectedKey: string;
  fetchKey: string;
  entity: Record<string, unknown>;
}

const checkCase: PageCase = {
  name: 'check request',
  path: '/finance/check-requests/:id',
  Page: CheckRequestDetailPage,
  selectedKey: 'selectedCheckRequest',
  fetchKey: 'fetchCheckRequest',
  entity: {
    ...base,
    requestNumber: 'CR-0001',
    requestedBy: 'u-2',
    payeeName: 'Hose Supply Co',
    amount: '400.00',
    status: 'issued',
    checkDate: '2026-03-10T15:00:00Z',
  },
};

const cases: PageCase[] = [
  {
    name: 'purchase request',
    path: '/finance/purchase-requests/:id',
    Page: PurchaseRequestDetailPage,
    selectedKey: 'selectedPurchaseRequest',
    fetchKey: 'fetchPurchaseRequest',
    entity: {
      ...base,
      requestNumber: 'PR-0001',
      title: 'New supply hose',
      requestedBy: 'u-2',
      estimatedAmount: '1250.00',
      priority: 'medium',
      status: 'paid',
      paidAt: '2026-03-10T15:00:00Z',
    },
  },
  {
    name: 'expense report',
    path: '/finance/expenses/:id',
    Page: ExpenseReportDetailPage,
    selectedKey: 'selectedExpenseReport',
    fetchKey: 'fetchExpenseReport',
    entity: {
      ...base,
      reportNumber: 'ER-0001',
      title: 'Conference mileage',
      submittedBy: 'u-2',
      totalAmount: '88.00',
      lineItems: [],
      status: 'paid',
      paidAt: '2026-03-10T15:00:00Z',
    },
  },
  checkCase,
];

const renderCase = (c: PageCase, extra: Record<string, unknown> = {}) => {
  storeState = {
    [c.selectedKey]: { ...c.entity, ...extra },
    isLoading: false,
    error: null,
    [c.fetchKey]: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={[c.path.replace(':id', 'e-1')]}>
      <Routes>
        <Route path={c.path} element={<c.Page />} />
      </Routes>
    </MemoryRouter>
  );
};

describe.each(cases)('$name detail page', (c) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says when the payment was sent to QuickBooks', async () => {
    renderCase(c, { qbExportedAt: '2026-04-01T13:00:00Z' });

    expect(await screen.findByText('Sent to QuickBooks')).toBeInTheDocument();
    // Created and paid are in March; April 1 is the export.
    expect(screen.getByText(/April 1, 2026/)).toBeInTheDocument();
  });

  it('says nothing about QuickBooks before it is sent', async () => {
    renderCase(c, { qbExportedAt: null });

    await screen.findByText('Created');
    expect(screen.queryByText('Sent to QuickBooks')).not.toBeInTheDocument();
  });
});

describe('a voided check', () => {
  it('says when it was voided and when the reversal was sent', async () => {
    renderCase(checkCase, {
      status: 'voided',
      qbExportedAt: '2026-04-01T13:00:00Z',
      voidedAt: '2026-04-03T16:00:00Z',
      qbVoidExportedAt: '2026-05-01T13:00:00Z',
    });

    expect(await screen.findByText('Void sent to QuickBooks')).toBeInTheDocument();
    expect(screen.getByText(/April 3, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/May 1, 2026/)).toBeInTheDocument();
  });
});
