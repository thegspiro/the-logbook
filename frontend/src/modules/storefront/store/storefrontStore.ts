/**
 * Storefront Store
 *
 * Member-facing store state: the offer catalog for the open order window, the
 * local (unsubmitted) cart, and the member's own order history.
 *
 * The cart lives here rather than on the server: it holds no money — prices are
 * recomputed server-side at checkout. It is also kept in this browser, per
 * member and per order window (utils/savedCart), holding only which lines and
 * how many; prices are rebuilt from the catalog on restore, so a saved cart
 * cannot carry a stale one.
 */

import { create } from 'zustand';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import type { CartLine, StoreOrder, Storefront, StorefrontProductOffer, StorefrontVariantOption } from '../types';
import { loadSavedCart, pruneSavedCarts, saveCart, type SavedCartLine } from '../utils/savedCart';

interface StorefrontState {
  storefront: Storefront | null;
  cart: CartLine[];
  /** The order window `cart` belongs to; each window keeps its own cart. */
  cartWindowId: string | null;
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

/** The preview unit price; the server recomputes it at submit. Personalizing
 *  costs the department extra per unit, so it is priced per line. */
const unitPriceFor = (
  offer: StorefrontProductOffer,
  variant: StorefrontVariantOption | undefined,
  personalizationText: string | undefined
): number => {
  const basePrice = Number(variant ? variant.price : offer.price);
  return personalizationText ? basePrice + Number(offer.personalizationPrice ?? 0) : basePrice;
};

/** Rebuild saved lines against the current catalog. A line whose product or
 *  variant is no longer offered, or whose personalization the product no
 *  longer takes, is dropped rather than shown at a guessed price. */
const restoreLines = (saved: SavedCartLine[], products: StorefrontProductOffer[]): CartLine[] =>
  saved.flatMap((line) => {
    const offer = products.find((p) => p.id === line.productId);
    if (!offer) return [];
    const variant = line.variantId ? offer.variants.find((v) => v.id === line.variantId) : undefined;
    if (line.variantId ? !variant : offer.requiresVariant) return [];
    const text = line.personalizationText?.trim() || undefined;
    if (text && !offer.personalizationEnabled) return [];
    return [
      {
        productId: offer.id,
        variantId: variant?.id,
        productName: offer.name,
        variantLabel: variant?.label,
        personalizationText: text,
        unitPrice: unitPriceFor(offer, variant, text),
        quantity: line.quantity,
        isTaxable: offer.isTaxable,
      },
    ];
  });

const currentMemberId = (): string | undefined => useAuthStore.getState().user?.id;

/** Keep the cart for the signed-in member and its window, if both are known. */
const persistCart = (cart: CartLine[], windowId: string | null): void => {
  const memberId = currentMemberId();
  if (memberId && windowId) saveCart(memberId, windowId, cart);
};

export const useStorefrontStore = create<StorefrontState>((set, get) => ({
  storefront: null,
  cart: [],
  cartWindowId: null,
  myOrders: [],
  isLoading: false,
  isSubmitting: false,
  error: null,

  loadStorefront: async (windowId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const storefront = await storefrontService.getStorefront(windowId);
      const openWindowId = storefront.window?.id ?? null;
      const memberId = currentMemberId();
      if (memberId) {
        // A closed window's cart can never be ordered, so it goes.
        const openIds = [openWindowId, ...storefront.otherOpenWindows.map((w) => w.id)];
        pruneSavedCarts(
          memberId,
          openIds.filter((id): id is string => Boolean(id))
        );
      }
      const { cart: current, cartWindowId } = get();
      let cart: CartLine[];
      if (cartWindowId === openWindowId && current.length > 0) {
        cart = current;
      } else if (memberId && openWindowId) {
        cart = restoreLines(loadSavedCart(memberId, openWindowId), storefront.products);
        persistCart(cart, openWindowId);
      } else {
        cart = [];
      }
      set({ storefront, cart, cartWindowId: openWindowId, isLoading: false });
    } catch (err: unknown) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Could not load the store'),
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
        error: getErrorMessage(err, 'Could not load your orders'),
      });
    }
  },

  addToCart: (offer, variantId, quantity, personalizationText) => {
    if (quantity <= 0) return;
    const variant = variantId ? offer.variants.find((v) => v.id === variantId) : undefined;
    const text = personalizationText?.trim() || undefined;
    const unitPrice = unitPriceFor(offer, variant, text);

    const existing = get().cart.find((line) => sameLine(line, offer.id, variantId, text));
    if (existing) {
      set({
        cart: get().cart.map((line) =>
          sameLine(line, offer.id, variantId, text) ? { ...line, quantity: line.quantity + quantity } : line
        ),
      });
      persistCart(get().cart, get().cartWindowId);
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
    persistCart(get().cart, get().cartWindowId);
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
    persistCart(get().cart, get().cartWindowId);
  },

  removeFromCart: (productId, variantId, personalizationText) => {
    set({
      cart: get().cart.filter((line) => !sameLine(line, productId, variantId, personalizationText)),
    });
    persistCart(get().cart, get().cartWindowId);
  },

  clearCart: () => {
    set({ cart: [] });
    persistCart([], get().cartWindowId);
  },

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
      persistCart([], get().cartWindowId);
      return order;
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Could not place your order');
      set({ isSubmitting: false, error: message });
      throw new Error(message, { cause: err });
    }
  },

  reset: () =>
    set({
      storefront: null,
      cart: [],
      cartWindowId: null,
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
