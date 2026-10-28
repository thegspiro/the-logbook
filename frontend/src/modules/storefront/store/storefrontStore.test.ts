import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetStorefront = vi.fn();
const mockGetMyOrders = vi.fn();
const mockPlaceOrder = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getStorefront: (...args: unknown[]) => mockGetStorefront(...args) as unknown,
    getMyOrders: (...args: unknown[]) => mockGetMyOrders(...args) as unknown,
    placeOrder: (...args: unknown[]) => mockPlaceOrder(...args) as unknown,
  },
}));

// Import the store AFTER the mocks are in place
import { computeCartTotals, useStorefrontStore } from './storefrontStore';
import { EmbroideryThreadColor, PersonalizationMethod } from '../types';
import type { Storefront, StorefrontProductOffer } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import type { CurrentUser } from '../../../types/auth';

const offer = (overrides: Partial<StorefrontProductOffer> = {}): StorefrontProductOffer => ({
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
  ...overrides,
});

describe('storefrontStore', () => {
  beforeEach(() => {
    useStorefrontStore.setState({
      storefront: null,
      cart: [],
      cartWindowId: null,
      myOrders: [],
      isLoading: false,
      isSubmitting: false,
      error: null,
    });
    useAuthStore.setState({ user: null });
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('loadStorefront', () => {
    it('stores the storefront payload', async () => {
      const payload = { isEnabled: true, storeName: 'Store', products: [] };
      mockGetStorefront.mockResolvedValue(payload);

      await useStorefrontStore.getState().loadStorefront();

      expect(mockGetStorefront).toHaveBeenCalledWith(undefined);
      expect(useStorefrontStore.getState().storefront).toEqual(payload);
      expect(useStorefrontStore.getState().isLoading).toBe(false);
    });

    it('passes a specific window id through', async () => {
      mockGetStorefront.mockResolvedValue({ products: [] });
      await useStorefrontStore.getState().loadStorefront('w1');
      expect(mockGetStorefront).toHaveBeenCalledWith('w1');
    });

    it('surfaces an error without throwing', async () => {
      mockGetStorefront.mockRejectedValue(new Error('boom'));
      await useStorefrontStore.getState().loadStorefront();
      expect(useStorefrontStore.getState().error).toBe('boom');
      expect(useStorefrontStore.getState().isLoading).toBe(false);
    });
  });

  describe('cart', () => {
    it('adds a line at the product price', () => {
      useStorefrontStore.getState().addToCart(offer(), undefined, 2);

      const { cart } = useStorefrontStore.getState();
      expect(cart).toHaveLength(1);
      expect(cart[0]?.unitPrice).toBe(45);
      expect(cart[0]?.quantity).toBe(2);
    });

    it('uses the variant price when a variant is chosen', () => {
      const withVariant = offer({
        requiresVariant: true,
        variants: [{ id: 'v1', label: '2XL', price: '48.00', isAvailable: true }],
      });
      useStorefrontStore.getState().addToCart(withVariant, 'v1', 1);

      const line = useStorefrontStore.getState().cart[0];
      expect(line?.unitPrice).toBe(48);
      expect(line?.variantLabel).toBe('2XL');
    });

    it('merges a repeated add of the same product and variant', () => {
      useStorefrontStore.getState().addToCart(offer(), undefined, 1);
      useStorefrontStore.getState().addToCart(offer(), undefined, 2);

      const { cart } = useStorefrontStore.getState();
      expect(cart).toHaveLength(1);
      expect(cart[0]?.quantity).toBe(3);
    });

    it('keeps different variants of one product as separate lines', () => {
      const withVariants = offer({
        variants: [
          { id: 'v1', label: 'L', price: '45.00', isAvailable: true },
          { id: 'v2', label: 'XL', price: '45.00', isAvailable: true },
        ],
      });
      useStorefrontStore.getState().addToCart(withVariants, 'v1', 1);
      useStorefrontStore.getState().addToCart(withVariants, 'v2', 1);

      expect(useStorefrontStore.getState().cart).toHaveLength(2);
    });

    it('ignores a non-positive add', () => {
      useStorefrontStore.getState().addToCart(offer(), undefined, 0);
      expect(useStorefrontStore.getState().cart).toHaveLength(0);
    });

    it('removes the line when the quantity drops to zero', () => {
      useStorefrontStore.getState().addToCart(offer(), undefined, 2);
      useStorefrontStore.getState().updateCartQuantity('p1', undefined, 0);
      expect(useStorefrontStore.getState().cart).toHaveLength(0);
    });

    it('removes a specific line', () => {
      useStorefrontStore.getState().addToCart(offer(), undefined, 1);
      useStorefrontStore.getState().addToCart(offer({ id: 'p2', name: 'Coin' }), undefined, 1);
      useStorefrontStore.getState().removeFromCart('p1', undefined);

      const { cart } = useStorefrontStore.getState();
      expect(cart).toHaveLength(1);
      expect(cart[0]?.productId).toBe('p2');
    });
  });

  describe('personalization', () => {
    const personalizable = () => offer({ personalizationEnabled: true, personalizationPrice: '8.00' });

    it('adds the upcharge to the line price', () => {
      useStorefrontStore.getState().addToCart(personalizable(), undefined, 1, 'SMITH');

      const line = useStorefrontStore.getState().cart[0];
      expect(line?.unitPrice).toBe(53);
      expect(line?.personalizationText).toBe('SMITH');
    });

    it('charges nothing extra without text', () => {
      useStorefrontStore.getState().addToCart(personalizable(), undefined, 1);
      expect(useStorefrontStore.getState().cart[0]?.unitPrice).toBe(45);
    });

    it('keeps different names as separate lines', () => {
      const product = personalizable();
      useStorefrontStore.getState().addToCart(product, undefined, 1, 'SMITH');
      useStorefrontStore.getState().addToCart(product, undefined, 1, 'JONES');

      const { cart } = useStorefrontStore.getState();
      expect(cart).toHaveLength(2);
      expect(cart.map((l) => l.personalizationText)).toEqual(['SMITH', 'JONES']);
    });

    it('merges repeat adds of the same name', () => {
      const product = personalizable();
      useStorefrontStore.getState().addToCart(product, undefined, 1, 'SMITH');
      useStorefrontStore.getState().addToCart(product, undefined, 2, 'SMITH');

      const { cart } = useStorefrontStore.getState();
      expect(cart).toHaveLength(1);
      expect(cart[0]?.quantity).toBe(3);
    });

    it('treats blank text as no personalization', () => {
      const product = personalizable();
      useStorefrontStore.getState().addToCart(product, undefined, 1, '   ');
      useStorefrontStore.getState().addToCart(product, undefined, 1);

      const { cart } = useStorefrontStore.getState();
      expect(cart).toHaveLength(1);
      expect(cart[0]?.personalizationText).toBeUndefined();
    });

    it('removes only the matching personalized line', () => {
      const product = personalizable();
      useStorefrontStore.getState().addToCart(product, undefined, 1, 'SMITH');
      useStorefrontStore.getState().addToCart(product, undefined, 1, 'JONES');
      useStorefrontStore.getState().removeFromCart(product.id, undefined, 'SMITH');

      const { cart } = useStorefrontStore.getState();
      expect(cart).toHaveLength(1);
      expect(cart[0]?.personalizationText).toBe('JONES');
    });

    it('sends the text through to the server', async () => {
      useStorefrontStore.getState().addToCart(personalizable(), undefined, 1, 'SMITH');
      mockPlaceOrder.mockResolvedValue({ id: 'o1', orderNumber: 'ORD-1' });

      await useStorefrontStore.getState().placeOrder({ fulfillmentMethod: 'pickup' });

      expect(mockPlaceOrder).toHaveBeenCalledWith({
        windowId: undefined,
        items: [
          {
            productId: 'p1',
            variantId: undefined,
            quantity: 1,
            personalizationText: 'SMITH',
          },
        ],
        paymentMethod: undefined,
        fulfillmentMethod: 'pickup',
        shippingAddress: undefined,
        memberNotes: undefined,
      });
    });
  });

  describe('placeOrder', () => {
    it('submits the cart and clears it', async () => {
      useStorefrontStore.setState({
        storefront: {
          isEnabled: true,
          storeName: 'Store',
          currency: 'USD',
          showOpenOrderBanner: true,
          allowPickup: true,
          allowShipping: false,
          taxRate: '0',
          acceptedPaymentMethods: ['venmo'],
          paymentMethods: [{ method: 'venmo', label: 'Venmo' }],
          paymentPolicy: 'none',
          sendsOrderConfirmation: true,
          products: [],
          window: { id: 'w1', name: 'Fall' },
          otherOpenWindows: [],
        },
      });
      useStorefrontStore.getState().addToCart(offer(), undefined, 2);
      mockPlaceOrder.mockResolvedValue({ id: 'o1', orderNumber: 'ORD-1' });

      const order = await useStorefrontStore.getState().placeOrder({
        paymentMethod: 'venmo',
        fulfillmentMethod: 'pickup',
      });

      expect(mockPlaceOrder).toHaveBeenCalledWith({
        windowId: 'w1',
        items: [{ productId: 'p1', variantId: undefined, quantity: 2 }],
        paymentMethod: 'venmo',
        fulfillmentMethod: 'pickup',
        shippingAddress: undefined,
        memberNotes: undefined,
      });
      expect(order.orderNumber).toBe('ORD-1');
      expect(useStorefrontStore.getState().cart).toHaveLength(0);
    });

    it('refuses to submit an empty cart', async () => {
      await expect(useStorefrontStore.getState().placeOrder({ fulfillmentMethod: 'pickup' })).rejects.toThrow(
        'Your cart is empty'
      );
      expect(mockPlaceOrder).not.toHaveBeenCalled();
    });

    it('keeps the cart when the server rejects the order', async () => {
      useStorefrontStore.getState().addToCart(offer(), undefined, 1);
      mockPlaceOrder.mockRejectedValue(new Error('Only 1 remain available'));

      await expect(useStorefrontStore.getState().placeOrder({ fulfillmentMethod: 'pickup' })).rejects.toThrow();
      expect(useStorefrontStore.getState().cart).toHaveLength(1);
      expect(useStorefrontStore.getState().isSubmitting).toBe(false);
    });
  });

  describe('loadMyOrders', () => {
    it('stores the member order list', async () => {
      mockGetMyOrders.mockResolvedValue([{ id: 'o1' }]);
      await useStorefrontStore.getState().loadMyOrders();
      expect(mockGetMyOrders).toHaveBeenCalledWith();
      expect(useStorefrontStore.getState().myOrders).toHaveLength(1);
    });
  });

  // W67-6: the cart is kept in this browser, per member and per order window.
  describe('saved cart', () => {
    const member = (id: string): CurrentUser => ({
      id,
      username: id,
      email: `${id}@fd.test`,
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
    });
    const shirt = offer({ id: 'p1', price: '45.00' });
    const jacket = offer({
      id: 'p2',
      name: 'Jacket',
      requiresVariant: true,
      variants: [{ id: 'v-l', label: 'L', price: '90.00', isAvailable: true }],
    });
    const storeFor = (windowId: string | null, products = [shirt, jacket], otherOpenWindows: string[] = []) =>
      ({
        isEnabled: true,
        storeName: 'Store',
        products,
        window: windowId ? { id: windowId, name: windowId } : null,
        otherOpenWindows: otherOpenWindows.map((id) => ({ id, name: id })),
      }) as unknown as Storefront;
    const store = () => useStorefrontStore.getState();

    beforeEach(() => {
      mockGetStorefront.mockReset();
      useAuthStore.setState({ user: member('m1') });
    });

    it('still loads a body that leaves out the window lists', async () => {
      mockGetStorefront.mockResolvedValue({ isEnabled: false, storeName: 'Store' });

      await store().loadStorefront();

      expect(store().error).toBeNull();
      expect(store().storefront).toEqual({ isEnabled: false, storeName: 'Store' });
      expect(store().cart).toEqual([]);
    });

    it('survives a reload: the cart comes back when the store loads again', async () => {
      mockGetStorefront.mockResolvedValue(storeFor('w1'));
      await store().loadStorefront();
      store().addToCart(jacket, 'v-l', 1);
      store().addToCart(shirt, undefined, 2);

      useStorefrontStore.setState({ storefront: null, cart: [], cartWindowId: null });
      await store().loadStorefront();

      expect(store().cart.map((l) => [l.productId, l.variantId, l.quantity])).toEqual([
        ['p2', 'v-l', 1],
        ['p1', undefined, 2],
      ]);
    });

    it('rebuilds prices from the current catalog and drops what is no longer offered', async () => {
      mockGetStorefront.mockResolvedValue(storeFor('w1'));
      await store().loadStorefront();
      store().addToCart(shirt, undefined, 1);
      store().addToCart(jacket, 'v-l', 1);

      useStorefrontStore.setState({ storefront: null, cart: [], cartWindowId: null });
      mockGetStorefront.mockResolvedValue(storeFor('w1', [offer({ id: 'p1', price: '50.00' })]));
      await store().loadStorefront();

      expect(store().cart).toHaveLength(1);
      expect(store().cart[0]?.unitPrice).toBe(50);
    });

    it('is not shown to another member signing in on the same browser', async () => {
      mockGetStorefront.mockResolvedValue(storeFor('w1'));
      await store().loadStorefront();
      store().addToCart(shirt, undefined, 1);

      useAuthStore.setState({ user: member('m2') });
      useStorefrontStore.setState({ storefront: null, cart: [], cartWindowId: null });
      await store().loadStorefront();

      expect(store().cart).toEqual([]);
    });

    it('keeps one cart per window', async () => {
      mockGetStorefront.mockResolvedValue(storeFor('w1', [shirt, jacket], ['w2']));
      await store().loadStorefront();
      store().addToCart(shirt, undefined, 1);

      mockGetStorefront.mockResolvedValue(storeFor('w2', [shirt, jacket], ['w1']));
      await store().loadStorefront('w2');
      expect(store().cart).toEqual([]);

      mockGetStorefront.mockResolvedValue(storeFor('w1', [shirt, jacket], ['w2']));
      await store().loadStorefront('w1');
      expect(store().cart.map((l) => l.productId)).toEqual(['p1']);
    });

    it("forgets a closed window's cart", async () => {
      mockGetStorefront.mockResolvedValue(storeFor('w1'));
      await store().loadStorefront();
      store().addToCart(shirt, undefined, 1);

      mockGetStorefront.mockResolvedValue(storeFor(null));
      await store().loadStorefront();

      expect(store().cart).toEqual([]);
      expect(localStorage.getItem('store-cart-m1-w1')).toBeNull();
    });

    it('is cleared once the order is placed', async () => {
      mockGetStorefront.mockResolvedValue(storeFor('w1'));
      await store().loadStorefront();
      store().addToCart(shirt, undefined, 1);
      mockPlaceOrder.mockResolvedValue({ id: 'o1' });

      await store().placeOrder({ fulfillmentMethod: 'pickup' });

      expect(localStorage.getItem('store-cart-m1-w1')).toBeNull();
    });
  });
});

describe('computeCartTotals', () => {
  const line = (overrides = {}) => ({
    productId: 'p1',
    productName: 'Job Shirt',
    unitPrice: 45,
    quantity: 1,
    isTaxable: false,
    ...overrides,
  });

  it('sums the lines', () => {
    const totals = computeCartTotals([line({ quantity: 2 }), line({ productId: 'p2', unitPrice: 10 })], 0);
    expect(totals.subtotal).toBe(100);
    expect(totals.total).toBe(100);
  });

  it('taxes only the taxable lines', () => {
    const totals = computeCartTotals([line({ isTaxable: true, unitPrice: 100 }), line({ unitPrice: 50 })], 0.06);
    expect(totals.tax).toBe(6);
    expect(totals.total).toBe(156);
  });

  it('rounds tax to cents', () => {
    const totals = computeCartTotals([line({ isTaxable: true, unitPrice: 45.99 })], 0.06);
    expect(totals.tax).toBe(2.76);
  });

  it('adds shipping', () => {
    const totals = computeCartTotals([line()], 0, 8.5);
    expect(totals.shipping).toBe(8.5);
    expect(totals.total).toBe(53.5);
  });

  it('handles an empty cart', () => {
    const totals = computeCartTotals([], 0.06);
    expect(totals).toEqual({ subtotal: 0, tax: 0, shipping: 0, total: 0 });
  });
});
