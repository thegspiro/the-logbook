import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetStorefront = vi.fn();
const mockPlaceOrder = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getStorefront: (...args: unknown[]) => mockGetStorefront(...args) as unknown,
    placeOrder: (...args: unknown[]) => mockPlaceOrder(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import CheckoutPage from './CheckoutPage';
import { useStorefrontStore } from '../store/storefrontStore';
import type { CartLine, Storefront } from '../types';

const storefront: Storefront = {
  isEnabled: true,
  storeName: 'Department Store',
  currency: 'USD',
  showOpenOrderBanner: true,
  allowPickup: true,
  allowShipping: true,
  pickupLocation: 'Station 1',
  shippingFlatRate: '9.00',
  taxRate: '0',
  acceptedPaymentMethods: ['venmo', 'zelle'],
  paymentMethods: [
    { method: 'venmo', label: 'Venmo', handle: '@FallsChurchFire', instructions: null },
    { method: 'zelle', label: 'Zelle', handle: 'treasurer@fcfd.example', instructions: null },
  ],
  paymentPolicy: 'before_vendor_order',
  otherOpenWindows: [],
  products: [],
  window: { id: 'w1', name: 'Fall 2026' },
};

const cart: CartLine[] = [
  {
    productId: 'p1',
    variantId: 'v-l',
    productName: 'Job Shirt',
    variantLabel: 'L',
    personalizationText: 'J. SMITH',
    unitPrice: 73,
    quantity: 1,
    isTaxable: true,
  },
];

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/store/checkout']}>
      <Routes>
        <Route path="/store" element={<div>Storefront</div>} />
        <Route path="/store/checkout" element={<CheckoutPage />} />
        <Route path="/store/orders" element={<div>My orders</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('CheckoutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStorefront.mockResolvedValue(storefront);
    useStorefrontStore.setState({
      storefront,
      cart,
      myOrders: [],
      isLoading: false,
      isSubmitting: false,
      error: null,
    });
  });

  it('reviews the order as a page, not a dialog', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Review your order' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Job Shirt/)).toBeInTheDocument();
    expect(screen.getByText(/Size L · Embroidered “J. SMITH”/)).toBeInTheDocument();
  });

  it('names where the money goes for each accepted method', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    expect(screen.getByRole('radio', { name: /Venmo/ })).toBeChecked();
    expect(screen.getByText('@FallsChurchFire')).toBeInTheDocument();
    expect(screen.getByText('treasurer@fcfd.example')).toBeInTheDocument();
  });

  it('adds the shipping flat rate to the total when shipping is chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    expect(screen.queryByLabelText(/Shipping address/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Ship to me/ }));

    expect(screen.getByLabelText(/Shipping address/)).toBeInTheDocument();
    expect(screen.getAllByText('$82.00').length).toBeGreaterThan(0);
  });

  it('submits the chosen method and fulfilment, then goes to my orders', async () => {
    const user = userEvent.setup();
    mockPlaceOrder.mockResolvedValue({ id: 'o1', orderNumber: 'ORD-1' });
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    await user.click(screen.getByRole('radio', { name: /Zelle/ }));
    await user.type(screen.getByLabelText(/Notes for the quartermaster/), 'Leave at the watch desk');
    await user.click(screen.getAllByRole('button', { name: 'Submit order' })[0] as HTMLElement);

    await waitFor(() => {
      expect(mockPlaceOrder).toHaveBeenCalledWith({
        windowId: 'w1',
        items: [{ productId: 'p1', variantId: 'v-l', quantity: 1, personalizationText: 'J. SMITH' }],
        paymentMethod: 'zelle',
        fulfillmentMethod: 'pickup',
        shippingAddress: undefined,
        memberNotes: 'Leave at the watch desk',
      });
    });
    expect(await screen.findByText('My orders')).toBeInTheDocument();
  });

  it('states the department payment policy rather than a generic promise', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    expect(screen.getByText(/Orders reach the vendor once payment is recorded/)).toBeInTheDocument();
  });

  it('renders a single fulfilment option as a statement, not a choice', async () => {
    useStorefrontStore.setState({ storefront: { ...storefront, allowShipping: false } });
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    // One option is not a choice; offered as one it sends a member hunting for
    // the alternative that is not there.
    expect(screen.queryByRole('radio', { name: /Ship to me/ })).not.toBeInTheDocument();
    expect(screen.getByText('Pick up at Station 1')).toBeInTheDocument();
  });

  it('sends an empty cart back to the store instead of reviewing nothing', async () => {
    useStorefrontStore.setState({ cart: [] });
    renderPage();

    expect(await screen.findByText('Storefront')).toBeInTheDocument();
  });
});
