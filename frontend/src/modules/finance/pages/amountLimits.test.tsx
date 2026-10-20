/**
 * The request forms turn back an amount the database cannot hold, or one that
 * rounds to nothing, with a message at the field. Every finance amount column
 * is Numeric(12, 2): at most 9,999,999,999.99 and at least one cent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

vi.mock('../services/api', () => ({
  fiscalYearService: { options: () => Promise.resolve([{ id: 'fy-1', name: 'FY2026', status: 'active' }]) },
  budgetService: { options: () => Promise.resolve([]) },
  purchaseRequestService: {},
  fundService: { list: () => Promise.resolve([]) },
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

const createPurchaseRequest = vi.fn();

const renderForm = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/finance/purchase-requests/new']}>
        <Routes>
          <Route path="/finance/purchase-requests/new" element={<PurchaseRequestFormPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

/** Submit past the browser's own min/max check, which jsdom would apply first. */
const submitWithAmount = async (amount: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('Brief title for the purchase'), 'Ladder');
  const field = screen.getByPlaceholderText('0.00');
  await user.clear(field);
  await user.type(field, amount);
  await screen.findByRole('option', { name: 'FY2026 (Active)' });
  fireEvent.submit(field);
};

beforeEach(() => {
  createPurchaseRequest.mockReset();
  createPurchaseRequest.mockResolvedValue({ id: 'pr-new' });
  storeState = { createPurchaseRequest, isLoading: false, fetchPurchaseRequest: vi.fn() };
});

describe('purchase request amount limits', () => {
  it('limits the amount input to the range the column can hold', () => {
    renderForm();

    const field = screen.getByPlaceholderText('0.00');
    expect(field).toHaveAttribute('min', '0.01');
    expect(field).toHaveAttribute('max', '9999999999.99');
  });

  it('refuses an amount larger than the database can store', async () => {
    renderForm();

    await submitWithAmount('10000000000');

    expect(await screen.findByText('That amount is too large.')).toBeInTheDocument();
    expect(createPurchaseRequest).not.toHaveBeenCalled();
  });

  it('refuses an amount that rounds to nothing, naming the minimum', async () => {
    renderForm();

    await submitWithAmount('0.004');

    expect(await screen.findByText('Amount must be at least $0.01')).toBeInTheDocument();
    expect(createPurchaseRequest).not.toHaveBeenCalled();
  });

  it('still refuses zero as not greater than zero', async () => {
    renderForm();

    await submitWithAmount('0');

    expect(await screen.findByText('Amount must be greater than zero')).toBeInTheDocument();
  });

  it('accepts the largest storable amount and one cent', async () => {
    renderForm();

    await submitWithAmount('9999999999.99');

    await vi.waitFor(() =>
      expect(createPurchaseRequest).toHaveBeenCalledWith(expect.objectContaining({ estimatedAmount: '9999999999.99' }))
    );
  });
});
