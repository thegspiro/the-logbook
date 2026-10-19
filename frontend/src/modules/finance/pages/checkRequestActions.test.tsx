/**
 * Workflow review W65: issuing and voiding a check.
 *
 * - A refused issue said only "Failed to issue check", hiding the reason (the
 *   treasurer had raised the check, so separation of duties refused it).
 * - Void acted on one tap, though it is final and reverses the spending.
 * - A payee ending in a full stop ("Valley Fuel Co.") read "Co.." in the
 *   issue dialog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { createMockApiError } from '@/test/utils';

const { storeState, issue, voidCheck, fetchCheckRequest, toastError, toastSuccess } = vi.hoisted(() => {
  const state: { current: Record<string, unknown> } = { current: {} };
  return {
    storeState: state,
    issue: vi.fn(),
    voidCheck: vi.fn(),
    fetchCheckRequest: vi.fn(),
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
    selector({
      checkPermission: (p) => ['finance.view', 'finance.manage'].includes(p),
      user: { id: 'u-treasurer' },
    }),
}));

vi.mock('../services/api', () => ({
  checkRequestService: {
    issue: (...args: unknown[]) => issue(...args) as unknown,
    void: (...args: unknown[]) => voidCheck(...args) as unknown,
  },
  functionalClassService: { setCheckRequest: vi.fn() },
  advanceService: { get: vi.fn(), deleteReturn: vi.fn() },
  approvalService: { manualApprove: vi.fn(), manualDeny: vi.fn() },
}));

import CheckRequestDetailPage from './CheckRequestDetailPage';

const renderPage = (status: string) => {
  storeState.current = {
    selectedCheckRequest: {
      id: 'cr-1',
      organizationId: 'org-1',
      fiscalYearId: 'fy-1',
      requestNumber: 'CK-2026-0001',
      payeeName: 'Valley Fuel Co.',
      amount: '612.40',
      status,
      requestedBy: 'u-treasurer',
      approvalSteps: [],
      createdAt: '2026-10-14T16:52:00Z',
      updatedAt: '2026-10-14T16:52:00Z',
    },
    isLoading: false,
    error: null,
    fetchCheckRequest,
    submitCheckRequest: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={['/finance/check-requests/cr-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/finance/check-requests/:id" element={<CheckRequestDetailPage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
};

describe('Issuing and voiding a check (W65)', () => {
  beforeEach(() => {
    for (const mock of [issue, voidCheck, fetchCheckRequest, toastError, toastSuccess]) mock.mockReset();
    issue.mockResolvedValue({});
    voidCheck.mockResolvedValue({});
  });

  it("shows the server's reason when issuing is refused", async () => {
    issue.mockRejectedValue(createMockApiError('You cannot issue your own check request.', 400));
    const user = userEvent.setup();
    renderPage('approved');

    await user.click(screen.getByRole('button', { name: 'Issue Check' }));
    await user.type(screen.getByLabelText('Check number'), '10452');
    await user.click(screen.getByRole('button', { name: 'Issue check' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('issue your own check request'))
    );
  });

  it('does not double the full stop after a payee that ends in one', async () => {
    const user = userEvent.setup();
    renderPage('approved');

    await user.click(screen.getByRole('button', { name: 'Issue Check' }));
    expect(await screen.findByText(/CK-2026-0001 will be marked as issued/)).toBeInTheDocument();
    // The name and the full stop are separate nodes, so read the dialog whole.
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/Co\.\./);
  });

  it('asks before voiding, and keeps the check when told to', async () => {
    const user = userEvent.setup();
    renderPage('issued');

    await user.click(screen.getByRole('button', { name: 'Void Request' }));
    expect(await screen.findByText(/This cannot be undone/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(voidCheck).not.toHaveBeenCalled();
  });

  it('voids once confirmed, and shows a refusal in its own words', async () => {
    voidCheck.mockRejectedValue(createMockApiError('Only issued checks can be voided', 400));
    const user = userEvent.setup();
    renderPage('issued');

    await user.click(screen.getByRole('button', { name: 'Void Request' }));
    await user.click(await screen.findByRole('button', { name: 'Void check' }));

    await waitFor(() => expect(voidCheck).toHaveBeenCalledWith('cr-1'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Only issued checks')));
  });
});
