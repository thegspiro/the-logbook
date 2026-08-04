/**
 * Storefront Page
 *
 * Member-facing store: browse what the open order window offers, build a cart,
 * and check out. Prices shown here are advisory — the server reprices every
 * line at submit, so the confirmation is the authoritative receipt.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CalendarClock, Loader2, Minus, Package, Plus, ShoppingBag, ShoppingCart, Store, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCurrency, formatDateTime } from '../../../utils/dateFormatting';
import { computeCartTotals, useStorefrontStore } from '../store/storefrontStore';
import { formatDateOnly } from '../utils/formatting';
import { PAYMENT_METHOD_LABELS, StoreFulfillmentMethod, type StorefrontProductOffer } from '../types';

const ProductCard: React.FC<{
  offer: StorefrontProductOffer;
  onAdd: (variantId: string | undefined, quantity: number) => void;
}> = ({ offer, onAdd }) => {
  const [variantId, setVariantId] = useState<string>(offer.variants[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);

  const selectedVariant = offer.variants.find((v) => v.id === variantId);
  const price = Number(selectedVariant ? selectedVariant.price : offer.price);
  const remaining = selectedVariant ? selectedVariant.availableQuantity : offer.availableQuantity;
  const soldOut = selectedVariant ? !selectedVariant.isAvailable : !offer.isAvailable;

  return (
    <div className="card-secondary flex flex-col gap-3 p-4">
      {offer.imageUrl ? (
        <img
          src={offer.imageUrl}
          alt={offer.name}
          className="bg-theme-surface-secondary h-40 w-full rounded-lg object-cover"
        />
      ) : (
        <div className="bg-theme-surface-secondary flex h-40 w-full items-center justify-center rounded-lg">
          <Package className="text-theme-text-muted h-10 w-10" />
        </div>
      )}

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-theme-text-primary text-sm font-semibold">{offer.name}</h3>
          <span className="text-theme-text-primary text-sm font-semibold whitespace-nowrap">
            {formatCurrency(price)}
          </span>
        </div>
        {offer.category && <p className="text-theme-text-muted mt-0.5 text-xs">{offer.category}</p>}
        {offer.description && (
          <p className="text-theme-text-secondary mt-2 text-xs whitespace-pre-line">{offer.description}</p>
        )}
      </div>

      {offer.variants.length > 0 && (
        <div>
          <label htmlFor={`variant-${offer.id}`} className="form-label text-xs">
            Option
          </label>
          <select
            id={`variant-${offer.id}`}
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className="form-input"
          >
            {offer.variants.map((variant) => (
              <option key={variant.id} value={variant.id} disabled={!variant.isAvailable}>
                {variant.label}
                {variant.isAvailable ? '' : ' — sold out'}
              </option>
            ))}
          </select>
        </div>
      )}

      {remaining != null && remaining <= 5 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {remaining > 0 ? `Only ${remaining} left` : 'Sold out'}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2">
        <div className="border-theme-surface-border flex items-center rounded-lg border">
          <button
            type="button"
            aria-label={`Decrease quantity of ${offer.name}`}
            className="btn-icon"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="text-theme-text-primary w-8 text-center text-sm">{quantity}</span>
          <button
            type="button"
            aria-label={`Increase quantity of ${offer.name}`}
            className="btn-icon"
            onClick={() => setQuantity((q) => q + 1)}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          className="btn-primary btn-md flex-1"
          disabled={soldOut || (offer.requiresVariant && !variantId)}
          onClick={() => {
            onAdd(variantId || undefined, quantity);
            setQuantity(1);
          }}
        >
          {soldOut ? 'Sold out' : 'Add to cart'}
        </button>
      </div>
    </div>
  );
};

const StorefrontPage: React.FC = () => {
  const tz = useTimezone();
  const navigate = useNavigate();
  const {
    storefront,
    cart,
    isLoading,
    isSubmitting,
    loadStorefront,
    addToCart,
    updateCartQuantity,
    removeFromCart,
    placeOrder,
  } = useStorefrontStore();

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [fulfillmentMethod, setFulfillmentMethod] = useState<string>(StoreFulfillmentMethod.PICKUP);
  const [shippingAddress, setShippingAddress] = useState('');
  const [memberNotes, setMemberNotes] = useState('');

  useEffect(() => {
    void loadStorefront();
  }, [loadStorefront]);

  useEffect(() => {
    if (!storefront) return;
    const methods = storefront.acceptedPaymentMethods;
    setPaymentMethod((current) => current || methods[0] || '');
    if (!storefront.allowPickup && storefront.allowShipping) {
      setFulfillmentMethod(StoreFulfillmentMethod.SHIP);
    }
  }, [storefront]);

  const shipping = fulfillmentMethod === StoreFulfillmentMethod.SHIP ? Number(storefront?.shippingFlatRate ?? 0) : 0;

  const totals = useMemo(
    () => computeCartTotals(cart, Number(storefront?.taxRate ?? 0), shipping),
    [cart, storefront?.taxRate, shipping]
  );

  const handleCheckout = useCallback(async () => {
    try {
      const order = await placeOrder({
        paymentMethod: paymentMethod || undefined,
        fulfillmentMethod,
        shippingAddress: shippingAddress.trim() || undefined,
        memberNotes: memberNotes.trim() || undefined,
      });
      setCheckoutOpen(false);
      setShippingAddress('');
      setMemberNotes('');
      toast.success(`Order ${order.orderNumber} submitted`);
      void navigate(`/store/orders?highlight=${order.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to place order');
    }
  }, [fulfillmentMethod, memberNotes, navigate, paymentMethod, placeOrder, shippingAddress]);

  if (isLoading && !storefront) {
    return (
      <div className="flex justify-center py-16" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!storefront?.isEnabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={Store}
          title="The store is closed"
          description="The department store is not currently accepting orders. Check back when the next order window opens."
        />
      </div>
    );
  }

  if (!storefront.window) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          icon={CalendarClock}
          title="No open order window"
          description="Ordering opens on a schedule. You'll get an email when the next window opens."
        >
          <Link to="/store/orders" className="btn-secondary btn-md">
            View my past orders
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-lg bg-blue-600 p-2">
              <Store className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-theme-text-primary truncate text-xl font-bold">{storefront.storeName}</h1>
              {storefront.tagline && <p className="text-theme-text-muted text-sm">{storefront.tagline}</p>}
            </div>
          </div>
          <Link to="/store/orders" className="btn-secondary btn-md shrink-0">
            <ShoppingBag className="h-4 w-4" />
            <span className="hidden sm:inline">My orders</span>
          </Link>
        </div>

        <div className="card mb-6 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <p className="text-theme-text-muted text-xs tracking-wide uppercase">Order window</p>
              {storefront.otherOpenWindows.length > 0 ? (
                <>
                  <label htmlFor="active-window" className="sr-only">
                    Choose an order window
                  </label>
                  <select
                    id="active-window"
                    value={storefront.window.id}
                    onChange={(e) => {
                      void loadStorefront(e.target.value);
                    }}
                    className="form-input-sm"
                  >
                    {[storefront.window, ...storefront.otherOpenWindows].map((openWindow) => (
                      <option key={openWindow.id} value={openWindow.id}>
                        {openWindow.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-theme-text-primary text-sm font-semibold">{storefront.window.name}</p>
              )}
            </div>
            {storefront.window.closesAt && (
              <div>
                <p className="text-theme-text-muted text-xs tracking-wide uppercase">Closes</p>
                <p className="text-theme-text-primary text-sm">{formatDateTime(storefront.window.closesAt, tz)}</p>
              </div>
            )}
            {storefront.window.expectedDeliveryDate && (
              <div>
                <p className="text-theme-text-muted text-xs tracking-wide uppercase">Expected delivery</p>
                <p className="text-theme-text-primary text-sm">
                  {formatDateOnly(storefront.window.expectedDeliveryDate)}
                </p>
              </div>
            )}
          </div>
          {storefront.window.description && (
            <p className="text-theme-text-secondary mt-3 text-sm whitespace-pre-line">
              {storefront.window.description}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {storefront.products.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Nothing listed yet"
                description="This order window doesn't have any items posted."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {storefront.products.map((offer) => (
                  <ProductCard
                    key={offer.id}
                    offer={offer}
                    onAdd={(variantId, quantity) => {
                      addToCart(offer, variantId, quantity);
                      toast.success(`${offer.name} added to cart`);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="card p-4 lg:sticky lg:top-4">
              <div className="mb-4 flex items-center gap-2">
                <ShoppingCart className="text-theme-text-muted h-4 w-4" />
                <h2 className="text-theme-text-primary text-sm font-semibold">Cart ({cart.length})</h2>
              </div>

              {cart.length === 0 ? (
                <p className="text-theme-text-muted text-sm">Nothing in your cart yet.</p>
              ) : (
                <>
                  <ul className="mb-4 space-y-3">
                    {cart.map((line) => (
                      <li key={`${line.productId}-${line.variantId ?? ''}`} className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-theme-text-primary truncate text-sm">{line.productName}</p>
                          {line.variantLabel && <p className="text-theme-text-muted text-xs">{line.variantLabel}</p>}
                          <div className="mt-1 flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              value={line.quantity}
                              aria-label={`Quantity for ${line.productName}`}
                              onChange={(e) =>
                                updateCartQuantity(line.productId, line.variantId, Number(e.target.value))
                              }
                              className="form-input w-16 py-1 text-sm"
                            />
                            <span className="text-theme-text-muted text-xs">× {formatCurrency(line.unitPrice)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${line.productName}`}
                          className="btn-icon text-theme-text-muted hover:text-red-500"
                          onClick={() => removeFromCart(line.productId, line.variantId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>

                  <dl className="border-theme-surface-border space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-theme-text-muted">Subtotal</dt>
                      <dd className="text-theme-text-primary">{formatCurrency(totals.subtotal)}</dd>
                    </div>
                    {totals.tax > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-theme-text-muted">Tax</dt>
                        <dd className="text-theme-text-primary">{formatCurrency(totals.tax)}</dd>
                      </div>
                    )}
                    {totals.shipping > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-theme-text-muted">Shipping</dt>
                        <dd className="text-theme-text-primary">{formatCurrency(totals.shipping)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 font-semibold">
                      <dt className="text-theme-text-primary">Total</dt>
                      <dd className="text-theme-text-primary">{formatCurrency(totals.total)}</dd>
                    </div>
                  </dl>

                  <button
                    type="button"
                    className="btn-primary btn-md mt-4 w-full"
                    onClick={() => setCheckoutOpen(true)}
                  >
                    Check out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="Review your order"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-md" onClick={() => setCheckoutOpen(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary btn-md"
              disabled={isSubmitting}
              onClick={() => {
                void handleCheckout();
              }}
            >
              {isSubmitting ? 'Submitting…' : 'Submit order'}
            </button>
          </div>
        }
      >
        <div className="modal-body space-y-4">
          <ul className="space-y-2">
            {cart.map((line) => (
              <li key={`review-${line.productId}-${line.variantId ?? ''}`} className="flex justify-between text-sm">
                <span className="text-theme-text-primary">
                  {line.quantity} × {line.productName}
                  {line.variantLabel ? ` (${line.variantLabel})` : ''}
                </span>
                <span className="text-theme-text-primary">{formatCurrency(line.unitPrice * line.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="border-theme-surface-border flex justify-between border-t pt-2 text-sm font-semibold">
            <span className="text-theme-text-primary">Total</span>
            <span className="text-theme-text-primary">{formatCurrency(totals.total)}</span>
          </div>

          <div>
            <label htmlFor="checkout-payment" className="form-label">
              How will you pay?
            </label>
            <select
              id="checkout-payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="form-input"
            >
              {storefront.acceptedPaymentMethods.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method] ?? method}
                </option>
              ))}
            </select>
            <p className="text-theme-text-muted mt-1 text-xs">
              You&apos;ll get payment instructions — including a payment link where available — as soon as the order is
              submitted.
            </p>
          </div>

          {storefront.allowPickup && storefront.allowShipping && (
            <div>
              <label htmlFor="checkout-fulfillment" className="form-label">
                Delivery
              </label>
              <select
                id="checkout-fulfillment"
                value={fulfillmentMethod}
                onChange={(e) => setFulfillmentMethod(e.target.value)}
                className="form-input"
              >
                <option value={StoreFulfillmentMethod.PICKUP}>
                  Pick up {storefront.pickupLocation ? `— ${storefront.pickupLocation}` : ''}
                </option>
                <option value={StoreFulfillmentMethod.SHIP}>Ship to me</option>
              </select>
            </div>
          )}

          {fulfillmentMethod === StoreFulfillmentMethod.SHIP && (
            <div>
              <label htmlFor="checkout-address" className="form-label">
                Shipping address
              </label>
              <textarea
                id="checkout-address"
                rows={3}
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
                className="form-input"
              />
            </div>
          )}

          <div>
            <label htmlFor="checkout-notes" className="form-label">
              Notes for the quartermaster (optional)
            </label>
            <textarea
              id="checkout-notes"
              rows={2}
              value={memberNotes}
              onChange={(e) => setMemberNotes(e.target.value)}
              className="form-input"
            />
          </div>

          {storefront.termsText && (
            <p className="text-theme-text-muted text-xs whitespace-pre-line">{storefront.termsText}</p>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default StorefrontPage;
