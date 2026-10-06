/**
 * The three request detail pages offer Approve / Deny for the step a pending
 * request is waiting on, and re-fetch the request once a decision is made.
 *
 * `ApprovalStepActions.test.tsx` covers when the buttons appear; this proves
 * each page is wired to it with the right status, steps and re-fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ApprovalStepRecord } from '../types';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockCheckPermission = vi.fn();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => mockCheckPermission(p) as boolean }),
}));

import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';
import ExpenseReportDetailPage from './ExpenseReportDetailPage';
import CheckRequestDetailPage from './CheckRequestDetailPage';

const approvalSteps: ApprovalStepRecord[] = [
  {
    id: 'sr-1',
    chainId: 'chain-1',
    stepId: 'step-1',
    entityType: 'purchase_request',
    entityId: 'e-1',
    status: 'approved',
    stepName: 'Lieutenant review',
    stepOrder: 1,
    createdAt: '2026-09-20T15:00:00Z',
  },
  {
    id: 'sr-2',
    chainId: 'chain-1',
    stepId: 'step-2',
    entityType: 'purchase_request',
    entityId: 'e-1',
    status: 'pending',
    stepName: 'Treasurer review',
    stepOrder: 2,
    createdAt: '2026-09-20T15:00:00Z',
    // The viewer flags come from the backend's approver matching; the page
    // only reads them.
    assigneeLabel: 'Treasurer position',
    canAct: true,
    requiresOverride: false,
  },
];

const base = {
  id: 'e-1',
  organizationId: 'org-1',
  fiscalYearId: 'fy-1',
  createdAt: '2026-09-20T15:00:00Z',
  updatedAt: '2026-09-20T15:00:00Z',
  approvalSteps,
};

interface PageCase {
  name: string;
  path: string;
  Page: React.FC;
  selectedKey: string;
  fetchKey: string;
  entity: Record<string, unknown>;
}

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
    },
  },
  {
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
    },
  },
];

const renderCase = (c: PageCase, status: string, steps: ApprovalStepRecord[] = approvalSteps) => {
  const fetch = vi.fn();
  const approveStep = vi.fn().mockResolvedValue(undefined);
  storeState = {
    [c.selectedKey]: { ...c.entity, status, approvalSteps: steps },
    isLoading: false,
    error: null,
    [c.fetchKey]: fetch,
    approveStep,
    denyStep: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={[c.path.replace(':id', 'e-1')]}>
      <Routes>
        <Route path={c.path} element={<c.Page />} />
      </Routes>
    </MemoryRouter>
  );
  return { fetch, approveStep };
};

describe.each(cases)('$name detail page approval actions', (c) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockImplementation((p: string) => p === 'finance.approve');
  });

  it('approves the pending step and re-fetches the request', async () => {
    const user = userEvent.setup();
    const { fetch, approveStep } = renderCase(c, 'pending_approval');
    // The page's own load on mount.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('e-1'));
    fetch.mockClear();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approveStep).toHaveBeenCalledWith('sr-2', undefined, undefined));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('e-1'));
  });

  it('offers nothing once the request has left pending approval', async () => {
    renderCase(c, 'approved');

    await screen.findByText('Approval Timeline');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting on/)).not.toBeInTheDocument();
  });

  it('only says who the step is waiting on when the viewer cannot act on it', async () => {
    mockCheckPermission.mockReturnValue(false);
    const steps = approvalSteps.map((s) => (s.id === 'sr-2' ? { ...s, canAct: false } : s));
    renderCase(c, 'pending_approval', steps);

    await screen.findByText('Approval Timeline');
    expect(screen.getByText(/Waiting on/)).toHaveTextContent('Waiting on Treasurer position.');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
