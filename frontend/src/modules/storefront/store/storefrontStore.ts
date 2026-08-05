/**
 * Storefront Store
 *
 * Member-facing store state: the offer catalog for the open order window, the
 * local (unsubmitted) cart, and the member's own order history.
 *
 * The cart lives here rather than on the server: it holds no money — prices are
 * recomputed server-side at checkout — so persisting it would buy nothing but a
 * stale-price bug.
 */

import { create } from 'zustand';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import type { CartLine, StoreOrder, Storefront, StorefrontProductOffer } from '../types';

interface StorefrontState {
  storefront: Storefront | null;
  cart: CartLine[];
  myOrders: StoreOrder[];
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;

  loadStorefront: (windowId?: string) => Promise<void>;
  loadMyOrders: () => Promise<void>;
  addToCart: (
    offer: StorefrontProductOffer,
    variantId: string | undefined,
    quantity: number,
    personalizationText?: string
  ) => void;
  updateCartQuantity: (
    productId: string,
    variantId: string | undefined,
    quantity: number,
    personalizationText?: string
  ) => void;
  removeFromCart: (productId: string, variantId: string | undefined, personalizationText?: string) => void;
  clearCart: () => void;
  placeOrder: (payload: {
    paymentMethod?: string | undefined;
    fulfillmentMethod: string;
    shippingAddress?: string | undefined;
    memberNotes?: string | undefined;
  }) => Promise<StoreOrder>;
  reset: () => void;
}

/** Two cart lines are the same line only if product, variant AND
 *  personalization all match — a shirt reading "SMITH" is not the same
 *  physical good as one reading "JONES". */
const sameLine = (line: CartLine, productId: string, variantId: string | undefined, personalizationText?: string) =>
  line.productId === productId &&
  (line.variantId ?? '') === (variantId ?? '') &&
  (line.personalizationText ?? '') === (personalizationText ?? '');

export const useStorefrontStore = create<StorefrontState>((set, get) => ({
  storefront: null,
  cart: [],
  myOrders: [],
  isLoading: false,
  isSubmitting: false,
  error: null,

  loadStorefront: async (windowId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const storefront = await storefrontService.getStorefront(windowId);
      set({ storefront, isLoading: false });
    } catch (err: unknown) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Failed to load the store'),
      });
    }
  },

  loadMyOrders: async () => {
    set({ isLoading: true, error: null });
    try {
      const myOrders = await storefrontService.getMyOrders();
      set({ myOrders, isLoading: false });
    } catch (err: unknown) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Failed to load your orders'),
      });
    }
  },

  addToCart: (offer, variantId, quantity, personalizationText) => {
    if (quantity <= 0) return;
    const variant = variantId ? offer.variants.find((v) => v.id === variantId) : undefined;
    const text = personalizationText?.trim() || undefined;
    const basePrice = Number(variant ? variant.price : offer.price);
    // Personalizing costs the department extra per unit, so it is priced per
    // line. The server recomputes this at submit; this is only the preview.
    const unitPrice = text ? basePrice + Number(offer.personalizationPrice ?? 0) : basePrice;

    const existing = get().cart.find((line) => sameLine(line, offer.id, variantId, text));
    if (existing) {
      set({
        cart: get().cart.map((line) =>
          sameLine(line, offer.id, variantId, text) ? { ...line, quantity: line.quantity + quantity } : line
        ),
      });
      return;
    }

    const line: CartLine = {
      productId: offer.id,
      variantId,
      productName: offer.name,
      variantLabel: variant?.label,
      personalizationText: text,
      unitPrice,
      quantity,
      isTaxable: offer.isTaxable,
    };
    set({ cart: [...get().cart, line] });
  },

  updateCartQuantity: (productId, variantId, quantity, personalizationText) => {
    if (quantity <= 0) {
      get().removeFromCart(productId, variantId, personalizationText);
      return;
    }
    set({
      cart: get().cart.map((line) =>
        sameLine(line, productId, variantId, personalizationText) ? { ...line, quantity } : line
      ),
    });
  },

  removeFromCart: (productId, variantId, personalizationText) => {
    set({
      cart: get().cart.filter((line) => !sameLine(line, productId, variantId, personalizationText)),
    });
  },

  clearCart: () => set({ cart: [] }),

  placeOrder: async (payload) => {
    const { cart, storefront } = get();
    if (cart.length === 0) {
      throw new Error('Your cart is empty');
    }
    set({ isSubmitting: true, error: null });
    try {
      const order = await storefrontService.placeOrder({
        windowId: storefront?.window?.id,
        items: cart.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          personalizationText: line.personalizationText,
        })),
        paymentMethod: payload.paymentMethod,
        fulfillmentMethod: payload.fulfillmentMethod,
        shippingAddress: payload.shippingAddress,
        memberNotes: payload.memberNotes,
      });
      set({ isSubmitting: false, cart: [] });
      return order;
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to place your order');
      set({ isSubmitting: false, error: message });
      throw new Error(message);
    }
  },

  reset: () =>
    set({
      storefront: null,
      cart: [],
      myOrders: [],
      isLoading: false,
      isSubmitting: false,
      error: null,
    }),
}));

/** Subtotal, tax and total for the current cart, using the store's tax rate. */
export const computeCartTotals = (
  cart: CartLine[],
  taxRate: number,
  shipping = 0
): { subtotal: number; tax: number; shipping: number; total: number } => {
  const subtotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const taxable = cart.reduce((sum, line) => (line.isTaxable ? sum + line.unitPrice * line.quantity : sum), 0);
  const tax = Math.round(taxable * taxRate * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax,
    shipping,
    total: Math.round((subtotal + tax + shipping) * 100) / 100,
  };
};
