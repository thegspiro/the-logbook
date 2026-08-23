import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGetStorefront = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getStorefront: (...args: unknown[]) => mockGetStorefront(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import StorefrontPage from './StorefrontPage';
import { useStorefrontStore } from '../store/storefrontStore';
import type { Storefront, StorefrontProductOffer } from '../types';

const product = (overrides: Partial<StorefrontProductOffer> = {}): StorefrontProductOffer => ({
  id: 'p1',
  name: 'Job Shirt',
  description: 'Navy quarter-zip',
  imageUrl: null,
  category: 'Uniforms',
  price: '65.00',
  isTaxable: true,
  requiresVariant: false,
  maxPerMember: null,
  personalizationEnabled: false,
  personalizationRequired: false,
  personalizationLabel: null,
  personalizationMaxLength: 16,
  personalizationPrice: '0.00',
  availableQuantity: null,
  isAvailable: true,
  variants: [],
  ...overrides,
});

const storefront = (overrides: Partial<Storefront> = {}): Storefront => ({
  isEnabled: true,
  storeName: 'Department Store',
  tagline: 'Uniforms and gear',
  currency: 'USD',
  showOpenOrderBanner: true,
  allowPickup: true,
  allowShipping: false,
  pickupLocation: 'Station 1',
  shippingFlatRate: '0',
  taxRate: '0',
  acceptedPaymentMethods: ['venmo', 'zelle', 'cash'],
  paymentMethods: [],
  paymentPolicy: 'none',
  otherOpenWindows: [],
  window: {
    id: 'w1',
    name: 'Fall 2026 Uniform Order',
    opensAt: '2026-09-01T00:00:00Z',
    closesAt: '2026-09-12T00:00:00Z',
    expectedDeliveryDate: '2026-10-15',
  },
  products: [
    product(),
    product({ id: 'p2', name: 'Ball Cap', category: 'Accessories', description: 'Adjustable', price: '22.00' }),
  ],
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/store']}>
      <Routes>
        <Route path="/store" element={<StorefrontPage />} />
        <Route path="/store/checkout" element={<div>Checkout</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('StorefrontPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStorefrontStore.setState({
      storefront: null,
      cart: [],
      myOrders: [],
      isLoading: false,
      isSubmitting: false,
      error: null,
    });
    mockGetStorefront.mockResolvedValue(storefront());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('states how long is left rather than only when the window shuts', async () => {
    // Five days before the close, from inside the window.
    vi.setSystemTime(new Date('2026-09-07T00:00:00Z'));
    renderPage();

    expect(await screen.findByText('5 days')).toBeInTheDocument();
    expect(screen.getByText('Fall 2026 Uniform Order is open')).toBeInTheDocument();
    expect(screen.getByText(/Delivery expected Oct 15, 2026 · pickup at Station 1/)).toBeInTheDocument();
  });

  it('drops the countdown for a window with no closing date', async () => {
    const open = storefront();
    mockGetStorefront.mockResolvedValue({
      ...open,
      window: { ...open.window, closesAt: null },
    });
    renderPage();

    await screen.findByText('Fall 2026 Uniform Order is open');
    expect(screen.queryByText('Closes in')).not.toBeInTheDocument();
    expect(screen.queryByText('Last day to order')).not.toBeInTheDocument();
  });

  it('filters the catalog by category, counting before the search box', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Job Shirt' });

    await user.click(screen.getByRole('button', { name: 'Accessories 1' }));

    expect(screen.getByRole('heading', { name: 'Ball Cap' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Job Shirt' })).not.toBeInTheDocument();
    // The counts describe the catalog, not the current filter.
    expect(screen.getByRole('button', { name: 'Uniforms 1' })).toBeInTheDocument();
  });

  it('searches on name and description', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Job Shirt' });

    await user.type(screen.getByLabelText('Search the catalog'), 'quarter-zip');

    expect(screen.getByRole('heading', { name: 'Job Shirt' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ball Cap' })).not.toBeInTheDocument();
  });

  it('says so when nothing matches instead of showing a bare grid', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Job Shirt' });

    await user.type(screen.getByLabelText('Search the catalog'), 'turnout gear');

    expect(screen.getByText('Nothing matches that')).toBeInTheDocument();
  });

  it('names the configured payment routes before the member commits', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Job Shirt' });

    await user.click(screen.getAllByRole('button', { name: /Add \$65\.00/ })[0] as HTMLElement);

    expect(
      screen.getByText(/Nothing is charged here\..*Venmo, Zelle or Cash.*as soon as you submit/)
    ).toBeInTheDocument();
  });

  it('takes the member to checkout from the cart', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Job Shirt' });

    await user.click(screen.getAllByRole('button', { name: /Add \$65\.00/ })[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: /Review order · \$65\.00/ }));

    expect(await screen.findByText('Checkout')).toBeInTheDocument();
  });

  it('keeps today’s empty and error states', async () => {
    mockGetStorefront.mockRejectedValueOnce(new Error('Network Error'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(screen.queryByText('The store is closed')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: 'Job Shirt' })).toBeInTheDocument();
  });
});
