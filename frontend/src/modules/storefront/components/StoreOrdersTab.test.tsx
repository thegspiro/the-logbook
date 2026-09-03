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
    await user.selectOptions(screen.getByLabelText(/payment method for selected/i), 'venmo');
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

  it('opens filtered when an order status is supplied', async () => {
    renderTab({ initialStatusFilter: 'ready_for_pickup' });

    await waitFor(() => {
      expect(mockGetOrders).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready_for_pickup' }));
    });
  });

  it('opens an initially selected order detail', async () => {
    renderTab({ initialOrderId: 'o1' });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockGetOrders).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 25 }));
  });

  it('opens and can clear a recent-orders queue', async () => {
    const user = userEvent.setup();
    renderTab({ initialSubmittedWithinHours: 24 });

    await waitFor(() => {
      expect(mockGetOrders).toHaveBeenCalledWith(expect.objectContaining({ submittedWithinHours: 24 }));
    });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => {
      expect(mockGetOrders).toHaveBeenLastCalledWith(expect.objectContaining({ submittedWithinHours: undefined }));
    });
  });

  it('opens and can clear the open-orders queue', async () => {
    const user = userEvent.setup();
    renderTab({ initialOpenOnly: true });

    await waitFor(() => {
      expect(mockGetOrders).toHaveBeenCalledWith(expect.objectContaining({ openOnly: true }));
    });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => {
      expect(mockGetOrders).toHaveBeenLastCalledWith(expect.objectContaining({ openOnly: undefined }));
    });
  });

  it('ignores a slower earlier fetch that lands after a filtered one', async () => {
    // Changing a filter starts a new request without cancelling the running
    // one, and they are not guaranteed to return in order. When the unfiltered
    // load issued on mount landed last it overwrote the filtered result, so the
    // status control read "Paid" over a list of every order -- six rows read as
    // though they were the two that were asked for.
    const paidOnly = order({ id: 'paid-1', orderNumber: 'ORD-2026-0002', status: 'paid' });
    const everything = [order(), paidOnly];

    // Keyed on the request rather than on call order: the tab issues more than
    // one unfiltered load while mounting, so mockImplementationOnce chains line
    // up against the wrong call. Every unfiltered fetch is held open; the
    // filtered one answers immediately.
    const held: (() => void)[] = [];
    mockGetOrders.mockImplementation(async (params: { status?: string }) => {
      if (params?.status === 'paid') return { items: [paidOnly], total: 1 };
      return new Promise((resolve) => {
        held.push(() => resolve({ items: everything, total: everything.length }));
      });
    });

    const user = userEvent.setup();
    renderTab();

    await waitFor(() => {
      expect(mockGetOrders).toHaveBeenCalled();
    });

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'paid');
    await waitFor(() => {
      expect(screen.getByText(/ORD-2026-0002/)).toBeInTheDocument();
    });

    // The mount requests now come back, carrying the unfiltered list.
    held.forEach((release) => release());

    await waitFor(() => {
      expect(screen.getByText(/ORD-2026-0002/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/ORD-2026-0001/)).not.toBeInTheDocument();
  });

  it('hides cancelled orders while verifying payments', async () => {
    // `cancel_order` leaves payment_status untouched, so a cancelled order
    // keeps pending_verification for ever — and recording a payment against a
    // cancelled order is refused, so the row is work nobody can do. The admin
    // hub's queue leaves them out of its count, and this is what keeps the
    // list agreeing with the headline that links to it.
    renderTab({ initialPaymentFilter: 'pending_verification' });

    await waitFor(() =>
      expect(mockGetOrders).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: 'pending_verification', excludeCancelled: true })
      )
    );
  });

  it('leaves cancelled orders in for every other payment filter', async () => {
    // A refunded or waived cancelled order is a legitimate thing to look up.
    renderTab({ initialPaymentFilter: 'refunded' });

    await waitFor(() =>
      expect(mockGetOrders).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: 'refunded', excludeCancelled: undefined })
      )
    );
  });

  it('does not open the order dialog when no order is deep-linked', async () => {
    // StoreAdminPage holds ordersDetailId as '' when nothing is deep-linked and
    // passes it straight down. `'' ?? null` is '', and OrderDetailModal opens on
    // `orderId !== null` -- so every visit to the Orders tab raised a dialog
    // stuck on "Loading…" (its fetch is guarded by `if (!orderId) return`) on
    // top of the list the administrator came to read.
    renderTab({ initialOrderId: '' });

    await waitFor(() => {
      expect(mockGetOrders).toHaveBeenCalled();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
