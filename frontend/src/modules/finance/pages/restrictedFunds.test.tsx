/**
 * Restricted funds on the request pages: the requester charges a fund on the
 * form, and the detail page names the fund and, until approval, how far the
 * request would take it past what it has left.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { id: string } }) => unknown) =>
    selector({ checkPermission: (p) => p === 'finance.request', user: { id: 'u-me' } }),
}));

const listFunds = vi.fn();
vi.mock('../services/api', () => ({
  fiscalYearService: {
    options: () => Promise.resolve([{ id: 'fy-1', name: 'FY2026', status: 'active' }]),
  },
  budgetService: { options: () => Promise.resolve([]) },
  purchaseRequestService: {},
  // The request form's approval-route panel asks for a preview 400ms after an
  // amount changes; under load that lands after a test has finished, and an
  // export missing from this mock was an unhandled error then.
  approvalChainService: { routePreview: () => Promise.resolve(null) },
  fundService: { list: () => listFunds() as unknown },
  financeSettingsService: {
    get: () =>
      Promise.resolve({
        dualApprovalThreshold: null,
        substantiationMode: 'off',
        substantiationDays: 60,
        fundOverspendMode: 'warn',
      }),
  },
}));

import PurchaseRequestFormPage from './PurchaseRequestFormPage';
import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';

const renderAt = (path: string, pattern: string, Page: React.FC) =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={<Page />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

beforeEach(() => {
  listFunds.mockReset();
  listFunds.mockResolvedValue([
    { campaignId: 'c-engine', name: 'Engine fund', purpose: 'Replace Engine 2', available: '380.00' },
  ]);
});

describe('the purchase request form', () => {
  it('charges the fund the requester picks', async () => {
    const createPurchaseRequest = vi.fn().mockResolvedValue({ id: 'pr-new' });
    storeState = { createPurchaseRequest, isLoading: false, fetchPurchaseRequest: vi.fn() };
    const user = userEvent.setup();
    renderAt('/finance/purchase-requests/new', '/finance/purchase-requests/new', PurchaseRequestFormPage);

    await user.type(screen.getByPlaceholderText('Brief title for the purchase'), 'Ladder');
    const amount = screen.getByPlaceholderText('0.00');
    await user.clear(amount);
    await user.type(amount, '400');
    await user.selectOptions(await screen.findByLabelText('Restricted fund'), 'c-engine');

    expect(screen.getByRole('status')).toHaveTextContent('This is $20.00 more than the fund has left.');

    await user.click(screen.getByRole('button', { name: /Save Draft/ }));

    await waitFor(() =>
      expect(createPurchaseRequest).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Ladder', estimatedAmount: '400.00', fundCampaignId: 'c-engine' })
      )
    );
  });

  it('sends no fund when none is picked', async () => {
    const createPurchaseRequest = vi.fn().mockResolvedValue({ id: 'pr-new' });
    storeState = { createPurchaseRequest, isLoading: false, fetchPurchaseRequest: vi.fn() };
    const user = userEvent.setup();
    renderAt('/finance/purchase-requests/new', '/finance/purchase-requests/new', PurchaseRequestFormPage);

    await user.type(screen.getByPlaceholderText('Brief title for the purchase'), 'Ladder');
    const amount = screen.getByPlaceholderText('0.00');
    await user.clear(amount);
    await user.type(amount, '40');
    await screen.findByLabelText('Restricted fund');
    await user.click(screen.getByRole('button', { name: /Save Draft/ }));

    await waitFor(() => expect(createPurchaseRequest).toHaveBeenCalled());
    expect(createPurchaseRequest.mock.calls[0]?.[0]).not.toHaveProperty('fundCampaignId');
  });
});

describe('the purchase request detail page', () => {
  const renderDetail = (extra: Record<string, unknown>) => {
    storeState = {
      selectedPurchaseRequest: {
        id: 'pr-1',
        organizationId: 'org-1',
        fiscalYearId: 'fy-1',
        requestNumber: 'PR-0001',
        title: 'Ladder',
        estimatedAmount: '400.00',
        priority: 'medium',
        status: 'pending_approval',
        requestedBy: 'u-someone',
        createdAt: '2026-09-20T15:00:00Z',
        updatedAt: '2026-09-20T15:00:00Z',
        approvalSteps: [],
        ...extra,
      },
      isLoading: false,
      error: null,
      fetchPurchaseRequest: vi.fn(),
    };
    renderAt('/finance/purchase-requests/pr-1', '/finance/purchase-requests/:id', PurchaseRequestDetailPage);
  };

  it('names the fund and how far it would go over', () => {
    renderDetail({ fundCampaignId: 'c-engine', fundName: 'Engine fund', fundShortfall: '20.00' });

    expect(screen.getByText('Engine fund')).toBeInTheDocument();
    expect(screen.getByText('This is $20.00 more than its restricted fund has left.')).toBeInTheDocument();
  });

  it('says nothing about funds for a request charged to none', () => {
    renderDetail({});

    expect(screen.queryByText('Restricted fund')).not.toBeInTheDocument();
    expect(screen.queryByText(/more than its restricted fund has left/)).not.toBeInTheDocument();
  });
});
