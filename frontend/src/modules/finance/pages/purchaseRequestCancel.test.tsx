/**
 * Cancelling a purchase request is final, so the page asks first, and a
 * refusal shows the server's reason rather than a generic failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

let storeState: Record<string, unknown> = {};
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const mockCheckPermission = vi.fn();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => mockCheckPermission(p) as boolean }),
}));

const mockCancel = vi.fn();
vi.mock('../services/api', () => ({
  approvalService: { manualApprove: vi.fn(), manualDeny: vi.fn() },
  functionalClassService: {},
  purchaseRequestService: { cancel: (...args: unknown[]) => mockCancel(...args) as unknown },
}));

import PurchaseRequestDetailPage from './PurchaseRequestDetailPage';

const fetchPurchaseRequest = vi.fn();

const renderPage = () => {
  storeState = {
    selectedPurchaseRequest: {
      id: 'pr-1',
      organizationId: 'org-1',
      fiscalYearId: 'fy-1',
      requestNumber: 'PR-0001',
      title: 'New supply hose',
      requestedBy: 'u-2',
      estimatedAmount: '1250.00',
      priority: 'medium',
      status: 'pending_approval',
      approvalSteps: [],
      createdAt: '2026-09-20T15:00:00Z',
      updatedAt: '2026-09-20T15:00:00Z',
    },
    isLoading: false,
    error: null,
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

describe('cancelling a purchase request', () => {
  beforeEach(() => {
    mockCancel.mockReset();
    mockCancel.mockResolvedValue({});
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    fetchPurchaseRequest.mockReset();
    mockCheckPermission.mockReset();
    mockCheckPermission.mockImplementation((p: string) => p === 'finance.manage');
  });

  it('asks before cancelling, and keeping it does nothing', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Cancel Request/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('emailed approval links stop working');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('cancels once confirmed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Cancel Request/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel request' }));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('pr-1'));
    expect(mockToastSuccess).toHaveBeenCalledWith('Purchase request cancelled');
  });

  it("shows the server's reason when the cancel is refused", async () => {
    mockCancel.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { status: 400, data: { detail: 'Paid requests cannot be cancelled' } },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Cancel Request/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel request' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Paid requests cannot be cancelled'));
  });
});
