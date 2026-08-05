import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockGetMyOrders = vi.fn();
const mockReportPayment = vi.fn();
const mockCancelMyOrder = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getMyOrders: (...args: unknown[]) => mockGetMyOrders(...args) as unknown,
    reportPayment: (...args: unknown[]) => mockReportPayment(...args) as unknown,
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

    // Zelle has no link to open, so it appears as a handle to type.
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

  it('shows an empty state when there are no orders', async () => {
    mockGetMyOrders.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
  });
});
