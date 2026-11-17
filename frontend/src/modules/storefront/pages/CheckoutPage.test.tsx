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
import { EmbroideryThreadColor, PersonalizationMethod } from '../types';
import type { CartLine, Storefront } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import type { CurrentUser } from '../../../types/auth';

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
  sendsOrderConfirmation: true,
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

  it('explains a method whose whole meaning is its instructions', async () => {
    // Cash, check, payroll deduction and a custom "Other" carry no handle.
    // Without their instructions a configured method renders as a bare label a
    // member has to choose blind.
    useStorefrontStore.setState({
      storefront: {
        ...storefront,
        paymentMethods: [
          { method: 'other', label: 'Other', handle: null, instructions: 'Payroll deduction over two pay periods' },
        ],
      },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    expect(screen.getByText('Payroll deduction over two pay periods')).toBeInTheDocument();
  });

  it('does not promise an email the department has switched off', async () => {
    useStorefrontStore.setState({ storefront: { ...storefront, sendsOrderConfirmation: false } });
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    expect(screen.getByText(/your order page will show where to send the money/)).toBeInTheDocument();
    expect(screen.queryByText(/confirmation email/)).not.toBeInTheDocument();
  });

  it('still promises the email where confirmations are on', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    expect(screen.getByText(/your order page and confirmation email will show/)).toBeInTheDocument();
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

  it('drops an address typed for shipping when the member switches back to pickup', async () => {
    // W67b-9: the hidden box kept its text and the home address was stored on
    // a pickup order that had no use for it.
    const user = userEvent.setup();
    mockPlaceOrder.mockResolvedValue({ id: 'o1', orderNumber: 'ORD-1' });
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    await user.click(screen.getByRole('radio', { name: /Ship to me/ }));
    await user.type(screen.getByLabelText(/Shipping address/), '12 Elm St');
    await user.click(screen.getByRole('radio', { name: /Pick up/ }));
    await user.click(screen.getAllByRole('button', { name: 'Submit order' })[0] as HTMLElement);

    await waitFor(() => expect(mockPlaceOrder).toHaveBeenCalled());
    expect(mockPlaceOrder).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentMethod: 'pickup', shippingAddress: undefined })
    );
  });

  it('states the department payment policy rather than a generic promise', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    expect(screen.getByText(/Your order goes to the vendor once your payment is recorded/)).toBeInTheDocument();
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

  it('names a missing shipping address on its field and places nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    await user.click(screen.getByRole('radio', { name: /Ship to me/ }));
    await user.click(screen.getAllByRole('button', { name: 'Submit order' })[0] as HTMLElement);

    const address = screen.getByLabelText(/Shipping address/);
    expect(address).toHaveAccessibleDescription('Enter the address to ship to, or choose pickup.');
    expect(address).toHaveFocus();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('puts a refusal of the address on its field', async () => {
    const user = userEvent.setup();
    mockPlaceOrder.mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ loc: ['body', 'shippingAddress'], msg: 'Address is too long' }] },
      },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    await user.click(screen.getByRole('radio', { name: /Ship to me/ }));
    await user.type(screen.getByLabelText(/Shipping address/), '1 Main St');
    await user.click(screen.getAllByRole('button', { name: 'Submit order' })[0] as HTMLElement);

    expect(await screen.findByText('Address is too long.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Shipping address/)).toHaveAccessibleDescription('Address is too long.');
    expect(screen.queryByText('My orders')).not.toBeInTheDocument();
  });

  it('keeps a failure no field answers for on the page', async () => {
    const user = userEvent.setup();
    mockPlaceOrder.mockRejectedValue({ response: { status: 409, data: { detail: 'This store window has closed' } } });
    renderPage();
    await screen.findByRole('heading', { name: 'Review your order' });

    await user.click(screen.getAllByRole('button', { name: 'Submit order' })[0] as HTMLElement);

    expect(await screen.findByRole('alert')).toHaveTextContent('This store window has closed');
  });

  it('comes back to the review on a reload, with the saved cart, instead of bouncing to the store', async () => {
    // W67b-10: a reload starts with no storefront and an empty in-memory
    // cart. The saved cart is restored only once the store loads, and the
    // page used to redirect before that load had even begun.
    const member: CurrentUser = {
      id: 'm1',
      username: 'm1',
      email: 'm1@fd.test',
      organization_id: 'org-1',
      timezone: 'UTC',
      roles: [],
      positions: [],
      rank: null,
      membership_type: null,
      permissions: [],
      is_active: true,
      email_verified: true,
      mfa_enabled: false,
      password_expired: false,
      must_change_password: false,
    };
    useAuthStore.setState({ user: member });
    localStorage.setItem('store-cart-m1-w1', JSON.stringify({ lines: [{ productId: 'p1', quantity: 2 }] }));
    mockGetStorefront.mockResolvedValue({
      ...storefront,
      products: [
        {
          id: 'p1',
          name: 'Job Shirt',
          price: '45.00',
          isTaxable: false,
          requiresVariant: false,
          personalizationEnabled: false,
          personalizationRequired: false,
          personalizationMaxLength: 30,
          personalizationPrice: '0',
          personalizationThreadColor: EmbroideryThreadColor.GOLD,
          personalizationThreadColorHex: '#c8a02c',
          personalizationMethod: PersonalizationMethod.EMBROIDERY,
          isAvailable: true,
          variants: [],
        },
      ],
    });
    useStorefrontStore.setState({ storefront: null, cart: [], cartWindowId: null, isLoading: false });

    try {
      renderPage();

      expect(await screen.findByRole('heading', { name: 'Review your order' })).toBeInTheDocument();
      expect(screen.getByText('Job Shirt × 2')).toBeInTheDocument();
      expect(screen.queryByText('Storefront')).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem('store-cart-m1-w1');
      useAuthStore.setState({ user: null });
    }
  });

  it('says the store could not be loaded, with a retry, rather than bouncing', async () => {
    mockGetStorefront.mockRejectedValue(new Error('Network down'));
    useStorefrontStore.setState({ storefront: null, cart: [], cartWindowId: null, isLoading: false, error: null });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Storefront')).not.toBeInTheDocument();
  });

  it('still sends an empty cart back to the store once the store has loaded', async () => {
    useStorefrontStore.setState({ storefront: null, cart: [], cartWindowId: null, isLoading: false });
    renderPage();

    expect(await screen.findByText('Storefront')).toBeInTheDocument();
    expect(mockGetStorefront).toHaveBeenCalled();
  });

  it('sends an empty cart back to the store instead of reviewing nothing', async () => {
    useStorefrontStore.setState({ cart: [] });
    renderPage();

    expect(await screen.findByText('Storefront')).toBeInTheDocument();
  });
});
