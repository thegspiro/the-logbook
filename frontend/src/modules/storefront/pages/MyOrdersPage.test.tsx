import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockGetMyOrders = vi.fn();
const mockReportPayment = vi.fn();
const mockUpdateMyPaymentMethod = vi.fn();
const mockCancelMyOrder = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getMyOrders: (...args: unknown[]) => mockGetMyOrders(...args) as unknown,
    reportPayment: (...args: unknown[]) => mockReportPayment(...args) as unknown,
    updateMyPaymentMethod: (...args: unknown[]) => mockUpdateMyPaymentMethod(...args) as unknown,
    cancelMyOrder: (...args: unknown[]) => mockCancelMyOrder(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MyOrdersPage from './MyOrdersPage';
import { useStorefrontStore } from '../store/storefrontStore';

const unpaidOrder = {
  id: 'o1',
  organizationId: 'org1',
  orderNumber: 'ORD-2026-0001',
  customerName: 'A. Member',
  windowName: 'Fall apparel',
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
  items: [
    {
      id: 'i1',
      productName: 'Job Shirt',
      variantLabel: 'L',
      unitPrice: '45.00',
      quantity: 1,
      lineTotal: '45.00',
      fulfilledQuantity: 0,
    },
  ],
  events: [],
  paymentInstructions: {
    method: 'venmo',
    label: 'Venmo',
    paymentUrl: 'https://venmo.com/FCFD?txn=pay&amount=45.00&note=ORD-2026-0001',
    handle: '@FCFD',
    reference: 'ORD-2026-0001',
    amountDue: '45.00',
    options: [
      {
        method: 'venmo',
        label: 'Venmo',
        handle: '@FCFD',
        paymentUrl: 'https://venmo.com/FCFD?txn=pay&amount=45.00&note=ORD-2026-0001',
        instructions: null,
        prefillsReference: true,
      },
      {
        method: 'zelle',
        label: 'Zelle',
        handle: 'treasurer@fcfd.example',
        paymentUrl: null,
        instructions: null,
        prefillsReference: false,
      },
    ],
  },
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <MyOrdersPage />
    </MemoryRouter>
  );

describe('MyOrdersPage', () => {
  beforeEach(() => {
    useStorefrontStore.setState({
      storefront: null,
      cart: [],
      myOrders: [],
      isLoading: false,
      isSubmitting: false,
      error: null,
    });
    vi.clearAllMocks();
    mockGetMyOrders.mockResolvedValue([unpaidOrder]);
  });

  it('lists the member orders', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'ORD-2026-0001' })).toBeInTheDocument();
    expect(screen.getByText(/Job Shirt/)).toBeInTheDocument();
    expect(mockGetMyOrders).toHaveBeenCalledWith();
  });

  it('shows the balance due and a prefilled payment link', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    const payLink = screen.getByRole('link', { name: /pay/i });
    expect(payLink).toHaveAttribute('href', 'https://venmo.com/FCFD?txn=pay&amount=45.00&note=ORD-2026-0001');
    expect(payLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText(/@FCFD/)).toBeInTheDocument();
  });

  it('offers every configured method, not only the one chosen at checkout', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    // Zelle has no link to open, so it appears beside the lead method as a
    // handle to type rather than a button that goes nowhere.
    expect(screen.getByText('Zelle')).toBeInTheDocument();
    expect(screen.getByText('treasurer@fcfd.example')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /pay/i })).toHaveLength(1);
  });

  it('reports a payment without marking the order paid client-side', async () => {
    const user = userEvent.setup();
    mockReportPayment.mockResolvedValue({ ...unpaidOrder });
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    await user.click(screen.getByRole('button', { name: /sent payment/i }));
    await user.type(screen.getByLabelText(/reference/i), 'venmo-1234');
    await user.click(screen.getByRole('button', { name: /report payment/i }));

    await waitFor(() => {
      expect(mockReportPayment).toHaveBeenCalledWith('o1', {
        paymentMethod: 'venmo',
        reference: 'venmo-1234',
      });
    });
  });

  it('lets a member change the planned payment method', async () => {
    const user = userEvent.setup();
    mockUpdateMyPaymentMethod.mockResolvedValue({ ...unpaidOrder, paymentMethod: 'zelle' });
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    await user.click(screen.getByRole('button', { name: /change payment method/i }));
    await user.selectOptions(screen.getByLabelText(/^payment method$/i), 'zelle');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateMyPaymentMethod).toHaveBeenCalledWith('o1', 'zelle');
    });
  });

  it('hides change payment method on a cancelled order', async () => {
    // The backend rejects the change for cancelled orders, so the button
    // must not be offered even while a balance remains on the order.
    mockGetMyOrders.mockResolvedValue([{ ...unpaidOrder, status: 'cancelled' }]);
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    expect(screen.queryByRole('button', { name: /change payment method/i })).not.toBeInTheDocument();
  });

  it('hides change payment method while a payment report awaits verification', async () => {
    mockGetMyOrders.mockResolvedValue([{ ...unpaidOrder, paymentStatus: 'pending_verification' }]);
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    expect(screen.queryByRole('button', { name: /change payment method/i })).not.toBeInTheDocument();
  });

  it('lets the member cancel an unfulfilled order', async () => {
    const user = userEvent.setup();
    mockCancelMyOrder.mockResolvedValue({ ...unpaidOrder, status: 'cancelled' });
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    await user.click(screen.getByRole('button', { name: /cancel order/i }));

    await waitFor(() => {
      expect(mockCancelMyOrder).toHaveBeenCalledWith('o1');
    });
  });

  it('hides cancel once the order is being fulfilled', async () => {
    mockGetMyOrders.mockResolvedValue([{ ...unpaidOrder, status: 'ready_for_pickup' }]);
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    expect(screen.queryByRole('button', { name: /cancel order/i })).not.toBeInTheDocument();
  });

  it('shows where the order has got to, and what is still ahead of it', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });

    expect(screen.getByRole('list', { name: 'Order progress' })).toBeInTheDocument();
    const current = screen.getAllByRole('listitem').find((item) => item.getAttribute('aria-current') === 'step');
    expect(current).toHaveTextContent('Payment due');
    expect(screen.getByText('Ready for pickup')).toBeInTheDocument();
  });

  it('replaces the stepper with a single line on a cancelled order', async () => {
    // A cancelled order did not stop somewhere along the track; it left it.
    mockGetMyOrders.mockResolvedValue([{ ...unpaidOrder, status: 'cancelled', balanceDue: '0.00' }]);
    renderPage();
    await screen.findByRole('button', { name: /ORD-2026-0001/ });

    await userEvent.click(screen.getByRole('button', { name: /ORD-2026-0001/ }));

    expect(screen.queryByRole('list', { name: 'Order progress' })).not.toBeInTheDocument();
    expect(screen.queryByText('Ready for pickup')).not.toBeInTheDocument();
  });

  it('collapses a settled order to one row and expands it on click', async () => {
    const user = userEvent.setup();
    mockGetMyOrders.mockResolvedValue([
      { ...unpaidOrder, status: 'fulfilled', paymentStatus: 'paid', amountPaid: '45.00', balanceDue: '0.00' },
    ]);
    renderPage();

    // Settled orders are the majority after a couple of windows, and are not
    // what a member opens this page to deal with.
    const row = await screen.findByRole('button', { name: /ORD-2026-0001/ });
    expect(screen.queryByRole('heading', { name: 'ORD-2026-0001' })).not.toBeInTheDocument();

    await user.click(row);

    expect(screen.getByRole('heading', { name: 'ORD-2026-0001' })).toBeInTheDocument();
  });

  it('opens the order it was sent here to show', async () => {
    mockGetMyOrders.mockResolvedValue([
      { ...unpaidOrder, status: 'fulfilled', paymentStatus: 'paid', amountPaid: '45.00', balanceDue: '0.00' },
    ]);
    render(
      <MemoryRouter initialEntries={['/store/orders?highlight=o1']}>
        <MyOrdersPage />
      </MemoryRouter>
    );

    // placeOrder redirects here with ?highlight=; a member who just ordered
    // should not have to find their own order in a list of collapsed rows.
    expect(await screen.findByRole('heading', { name: 'ORD-2026-0001' })).toBeInTheDocument();
  });

  it('shows an empty state when there are no orders', async () => {
    mockGetMyOrders.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
  });
  it('reports a failed load instead of claiming the member has no orders', async () => {
    mockGetMyOrders.mockRejectedValue(new Error('Network Error'));
    renderPage();

    // The empty state is a statement about the member's account; a load
    // failure must not be dressed up as one.
    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('retries the load from the error state', async () => {
    mockGetMyOrders.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce([unpaidOrder]);
    renderPage();
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { name: 'ORD-2026-0001' })).toBeInTheDocument();
  });
});
