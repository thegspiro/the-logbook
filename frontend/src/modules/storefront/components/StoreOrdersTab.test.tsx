import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetOrders = vi.fn();
const mockGetWindows = vi.fn();
const mockMarkOrderPaid = vi.fn();
const mockBulkMarkPaid = vi.fn();
const mockBulkUpdateStatus = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getOrders: (...args: unknown[]) => mockGetOrders(...args) as unknown,
    getWindows: (...args: unknown[]) => mockGetWindows(...args) as unknown,
    markOrderPaid: (...args: unknown[]) => mockMarkOrderPaid(...args) as unknown,
    bulkMarkPaid: (...args: unknown[]) => mockBulkMarkPaid(...args) as unknown,
    bulkUpdateStatus: (...args: unknown[]) => mockBulkUpdateStatus(...args) as unknown,
    exportOrders: vi.fn(),
    getOrder: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { StoreOrdersTab } from './StoreOrdersTab';

const order = (overrides: Record<string, unknown> = {}) => ({
  id: 'o1',
  organizationId: 'org1',
  orderNumber: 'ORD-2026-0001',
  customerName: 'A. Member',
  status: 'awaiting_payment',
  paymentStatus: 'unpaid',
  paymentMethod: 'venmo',
  subtotal: '45.00',
  taxAmount: '0.00',
  shippingAmount: '0.00',
  discountAmount: '0.00',
  total: '45.00',
  amountPaid: '0.00',
  balanceDue: '45.00',
  fulfillmentMethod: 'pickup',
  submittedAt: '2026-08-01T12:00:00Z',
  items: [],
  events: [],
  ...overrides,
});

const renderTab = (props: Record<string, unknown> = {}) => render(<StoreOrdersTab onChanged={vi.fn()} {...props} />);

describe('StoreOrdersTab payment handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWindows.mockResolvedValue([]);
    mockGetOrders.mockResolvedValue({
      items: [order()],
      total: 1,
      page: 1,
      pageSize: 25,
    });
  });

  it('offers a one-click mark-paid on an order with a balance', async () => {
    const user = userEvent.setup();
    mockMarkOrderPaid.mockResolvedValue(order({ balanceDue: '0.00' }));
    renderTab();
    await screen.findByText(/ORD-2026-0001/);

    await user.click(screen.getByRole('button', { name: /^mark paid$/i }));

    await waitFor(() => {
      expect(mockMarkOrderPaid).toHaveBeenCalledWith('o1', {
        paymentMethod: 'venmo',
        notifyMember: true,
      });
    });
  });

  it('hides mark-paid once the balance is settled', async () => {
    mockGetOrders.mockResolvedValue({
      items: [order({ balanceDue: '0.00', paymentStatus: 'paid' })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderTab();
    await screen.findByText(/ORD-2026-0001/);

    expect(screen.queryByRole('button', { name: /^mark paid$/i })).not.toBeInTheDocument();
  });

  it('hides mark-paid on a cancelled order', async () => {
    mockGetOrders.mockResolvedValue({
      items: [order({ status: 'cancelled' })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderTab();
    await screen.findByText(/ORD-2026-0001/);

    expect(screen.queryByRole('button', { name: /^mark paid$/i })).not.toBeInTheDocument();
  });

  it('bulk-marks the selection paid with a reference', async () => {
    const user = userEvent.setup();
    mockBulkMarkPaid.mockResolvedValue({ updated: 1, skipped: 0 });
    renderTab();
    await screen.findByText(/ORD-2026-0001/);

    await user.click(screen.getByLabelText(/select order ORD-2026-0001/i));
    await user.selectOptions(screen.getByLabelText(/payment method/i), 'venmo');
    await user.type(screen.getByLabelText(/payment reference/i), 'statement-2026-08');
    await user.click(screen.getByRole('button', { name: /mark selected paid/i }));

    await waitFor(() => {
      expect(mockBulkMarkPaid).toHaveBeenCalledWith({
        orderIds: ['o1'],
        paymentMethod: 'venmo',
        reference: 'statement-2026-08',
        notifyMembers: true,
      });
    });
  });

  it('select-all picks up every order on the page', async () => {
    const user = userEvent.setup();
    mockGetOrders.mockResolvedValue({
      items: [order(), order({ id: 'o2', orderNumber: 'ORD-2026-0002' })],
      total: 2,
      page: 1,
      pageSize: 25,
    });
    mockBulkMarkPaid.mockResolvedValue({ updated: 2, skipped: 0 });
    renderTab();
    await screen.findByText(/ORD-2026-0001/);

    await user.click(screen.getByLabelText(/select all on this page/i));
    await user.click(screen.getByRole('button', { name: /mark selected paid/i }));

    await waitFor(() => {
      expect(mockBulkMarkPaid).toHaveBeenCalledWith({
        orderIds: ['o1', 'o2'],
        paymentMethod: undefined,
        reference: undefined,
        notifyMembers: true,
      });
    });
  });

  it('opens filtered when a payment filter is supplied', async () => {
    renderTab({ initialPaymentFilter: 'pending_verification' });

    await waitFor(() => {
      expect(mockGetOrders).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: 'pending_verification' }));
    });
  });
});
