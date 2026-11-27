/**
 * App-review FIN6-F2: with no record in hand, every failure read "Purchase
 * request not found … has been removed", including a timeout or a 500.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));
vi.mock('../services/api', () => ({
  approvalService: { manualApprove: vi.fn(), manualDeny: vi.fn() },
  functionalClassService: {},
  purchaseRequestService: { cancel: vi.fn() },
}));

import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';

const fetchPurchaseRequest = vi.fn();

const renderPage = (error: string | null) => {
  storeState = {
    selectedPurchaseRequest: null,
    isLoading: false,
    error,
    fetchPurchaseRequest,
    submitPurchaseRequest: vi.fn(),
  };
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/finance/purchase-requests/pr-1']}>
        <Routes>
          <Route path="/finance/purchase-requests/:id" element={<PurchaseRequestDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );
};

describe('a purchase request that could not be loaded', () => {
  beforeEach(() => {
    fetchPurchaseRequest.mockReset();
  });

  it('says why and offers Retry, rather than calling it removed', async () => {
    const user = userEvent.setup();
    renderPage('Network Error');

    expect(screen.getByRole('alert')).toHaveTextContent('Network Error');
    expect(screen.queryByText('Purchase request not found')).not.toBeInTheDocument();
    fetchPurchaseRequest.mockClear();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(fetchPurchaseRequest).toHaveBeenCalledWith('pr-1');
  });

  it('still says not found when nothing failed', () => {
    renderPage(null);

    expect(screen.getByText('Purchase request not found')).toBeInTheDocument();
  });
});
