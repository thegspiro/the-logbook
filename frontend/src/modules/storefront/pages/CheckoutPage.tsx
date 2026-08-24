/**
 * Checkout Page
 *
 * The review step, as a page rather than the dialog it used to be. Four
 * decisions — items, payment method, fulfilment, notes — plus a summary do not
 * fit a 512px modal column on a phone without scrolling, and a checkout that
 * scrolls inside a box reads as a form to fill in rather than an order to
 * place.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ArrowLeft, Banknote, Building2, CheckCircle2, CreditCard, MapPin, Smartphone, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { formatCurrency } from '../../../utils/dateFormatting';
import { cartLineKey, cartLineMeta } from '../utils/cartLines';
import { productGlyph } from '../utils/productGlyph';
import { computeCartTotals, useStorefrontStore } from '../store/storefrontStore';
import { StoreFulfillmentMethod, StorePaymentMethod, StorePaymentPolicy } from '../types';

const METHOD_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  [StorePaymentMethod.VENMO]: Smartphone,
  [StorePaymentMethod.PAYPAL]: CreditCard,
  [StorePaymentMethod.CASH_APP]: Smartphone,
  [StorePaymentMethod.ZELLE]: Smartphone,
  [StorePaymentMethod.CASH]: Banknote,
  [StorePaymentMethod.CHECK]: Banknote,
  [StorePaymentMethod.PAYROLL_DEDUCTION]: Building2,
};

/* Real <input type="radio"> behind each tile rather than role="radio" on a
   button: a native radio group already does arrow-key navigation, roving
   tab-stops and form semantics, none of which a hand-rolled group gets for
   free — and a checkout is the last place to ship a half-implemented one. */
const TILE_BASE =
  'has-[:focus-visible]:ring-theme-focus-ring flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg p-3.5 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2';
const TILE_SELECTED = 'border-2 border-red-800 bg-red-50 dark:border-red-600 dark:bg-red-500/15';
const TILE_IDLE = 'border-theme-surface-border hover:bg-theme-surface-hover border';

const CheckoutPage: React.FC = () => {
  const navigate = useNavigate();
  const { storefront, cart, isLoading, isSubmitting, loadStorefront, placeOrder } = useStorefrontStore();

  const [paymentMethod, setPaymentMethod] = useState('');
  const [fulfillmentMethod, setFulfillmentMethod] = useState<string>(StoreFulfillmentMethod.PICKUP);
  const [shippingAddress, setShippingAddress] = useState('');
  const [memberNotes, setMemberNotes] = useState('');

  // A member who reloads on this URL, or lands on it from a bookmark, has no
  // storefront in memory — the cart is deliberately unpersisted, but the tax
  // rate and accepted methods have to come back before the summary is honest.
  useEffect(() => {
    if (!storefront) void loadStorefront();
  }, [loadStorefront, storefront]);

  useEffect(() => {
    if (!storefront) return;
    // Optional-chained through the array itself: a deployment whose backend
    // predates this field serves no paymentMethods at all, and a checkout
    // that throws is worse than one with no method preselected.
    setPaymentMethod((current) => current || storefront.paymentMethods?.[0]?.method || '');
    if (!storefront.allowPickup && storefront.allowShipping) {
      setFulfillmentMethod(StoreFulfillmentMethod.SHIP);
    }
  }, [storefront]);

  const shipping = fulfillmentMethod === StoreFulfillmentMethod.SHIP ? Number(storefront?.shippingFlatRate ?? 0) : 0;

  const totals = useMemo(
    () => computeCartTotals(cart, Number(storefront?.taxRate ?? 0), shipping),
    [cart, shipping, storefront?.taxRate]
  );

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const handleSubmit = useCallback(async () => {
    try {
      const order = await placeOrder({
        paymentMethod: paymentMethod || undefined,
        fulfillmentMethod,
        shippingAddress: shippingAddress.trim() || undefined,
        memberNotes: memberNotes.trim() || undefined,
      });
      toast.success(`Order ${order.orderNumber} submitted`);
      void navigate(`/store/orders?highlight=${order.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to place order');
    }
  }, [fulfillmentMethod, memberNotes, navigate, paymentMethod, placeOrder, shippingAddress]);

  if (isLoading && !storefront) {
    return <SkeletonPage />;
  }

  // Nothing to review. Bounce rather than render an order for zero items —
  // this is also the state a member lands in when they press Back after
  // submitting, since a placed order empties the cart.
  if (cart.length === 0) {
    return <Navigate to="/store" replace />;
  }

  const methods = storefront?.paymentMethods ?? [];
  const allowPickup = storefront?.allowPickup ?? true;
  const allowShipping = storefront?.allowShipping ?? false;
  const bothFulfilments = allowPickup && allowShipping;
  const shippingRate = Number(storefront?.shippingFlatRate ?? 0);

  const embroidery = cart.reduce((sum, line) => (line.personalizationText ? sum + line.quantity : sum), 0);

  /** The personalization upcharge folded into a line's unit price. Shown on the
   *  review so the line total is explicable rather than merely asserted. */
  const upchargeFor = (productId: string): number =>
    Number(storefront?.products.find((offer) => offer.id === productId)?.personalizationPrice ?? 0);

  const vendorGate =
    storefront?.paymentPolicy === StorePaymentPolicy.BEFORE_VENDOR_ORDER
      ? 'Payable to the department after you submit. Orders reach the vendor once payment is recorded.'
      : storefront?.paymentPolicy === StorePaymentPolicy.BEFORE_PICKUP
        ? 'Payable to the department after you submit. Your item is held for collection until payment is recorded.'
        : 'Payable to the department after you submit. Nothing here is charged now.';

  const pickingUp = fulfillmentMethod === StoreFulfillmentMethod.PICKUP;

  const pickupTile = (
    <>
      <MapPin
        className={`h-[18px] w-[18px] shrink-0 ${
          pickingUp ? 'text-red-900 dark:text-red-200' : 'text-theme-text-secondary'
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-theme-text-primary text-sm font-semibold">
          Pick up{storefront?.pickupLocation ? ` at ${storefront.pickupLocation}` : ''}
        </p>
        <p className="text-theme-text-secondary mt-0.5 text-xs">Free · ready when the order lands</p>
      </div>
    </>
  );

  const shipTile = (
    <>
      <Truck className="text-theme-text-secondary h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-theme-text-primary text-sm font-semibold">Ship to me</p>
        <p className="text-theme-text-secondary mt-0.5 text-xs">
          {shippingRate > 0 ? `+${formatCurrency(shippingRate)} flat rate` : 'Free'}
        </p>
      </div>
    </>
  );

  return (
    <div className="motion-safe:animate-page-enter min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Link
            to="/store"
            className="text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to the store
          </Link>
          <ol aria-label="Checkout steps" className="ml-auto hidden items-center gap-2 text-[13px] sm:flex">
            {[
              { step: 1, label: 'Cart', state: 'done' },
              { step: 2, label: 'Review', state: 'current' },
              { step: 3, label: 'Pay', state: 'todo' },
            ].map((entry, index) => (
              <React.Fragment key={entry.label}>
                {index > 0 && <li aria-hidden="true" className="bg-theme-surface-border h-px w-6" />}
                <li
                  className={`flex items-center gap-1.5 ${
                    entry.state === 'current' ? 'text-theme-text-primary font-semibold' : 'text-theme-text-secondary'
                  }`}
                  {...(entry.state === 'current' ? { 'aria-current': 'step' as const } : {})}
                >
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      entry.state === 'current'
                        ? 'bg-red-800 text-white'
                        : 'bg-theme-surface-hover text-theme-text-secondary'
                    }`}
                  >
                    {entry.step}
                  </span>
                  {entry.label}
                </li>
              </React.Fragment>
            ))}
          </ol>
        </div>

        <h1 className="text-theme-text-primary mb-5 text-2xl font-bold">Review your order</h1>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <section className="card p-4 sm:p-5">
              <h2 className="text-theme-text-primary mb-3.5 text-[15px] font-bold">
                {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </h2>
              <ul className="flex flex-col gap-3">
                {cart.map((line) => {
                  const Glyph = productGlyph({ name: line.productName });
                  return (
                    <li key={cartLineKey(line)} className="flex items-center gap-3">
                      <div className="bg-theme-surface-hover flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
                        <Glyph className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-theme-text-primary text-sm font-semibold">
                          {line.productName} × {line.quantity}
                        </p>
                        {cartLineMeta(line) && (
                          <p className="text-theme-text-secondary mt-0.5 text-xs">
                            {cartLineMeta(line)}
                            {line.personalizationText && upchargeFor(line.productId) > 0
                              ? ` (+${formatCurrency(upchargeFor(line.productId))})`
                              : ''}
                          </p>
                        )}
                      </div>
                      <span className="text-theme-text-primary font-mono text-sm whitespace-nowrap">
                        {formatCurrency(line.unitPrice * line.quantity)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {methods.length > 0 && (
              <section className="card p-4 sm:p-5">
                <h2 className="text-theme-text-primary text-[15px] font-bold">How you&apos;ll pay</h2>
                <p className="text-theme-text-secondary mt-1 mb-3.5 text-[13px]">
                  Pick one now — you&apos;ll get the handle and a payment link on the confirmation screen
                  {storefront?.sendsOrderConfirmation === false ? '' : ' and by email'}. The department records the
                  payment when it arrives.
                </p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {methods.map((option) => {
                    const Icon = METHOD_ICONS[option.method] ?? Banknote;
                    const selected = paymentMethod === option.method;
                    return (
                      <label key={option.method} className={`${TILE_BASE} ${selected ? TILE_SELECTED : TILE_IDLE}`}>
                        <input
                          type="radio"
                          name="payment-method"
                          className="sr-only"
                          value={option.method}
                          checked={selected}
                          onChange={() => setPaymentMethod(option.method)}
                        />
                        <span className="bg-theme-surface-hover text-theme-text-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-theme-text-primary block text-sm font-semibold">{option.label}</span>
                          {option.handle ? (
                            <span className="text-theme-text-secondary mt-0.5 block truncate font-mono text-xs">
                              {option.handle}
                            </span>
                          ) : (
                            // Cash, check, payroll deduction and a custom "Other"
                            // have no handle — their instructions are the whole
                            // explanation, and without them a configured method
                            // reads as a bare, unexplained "Other".
                            option.instructions && (
                              <span className="text-theme-text-secondary mt-0.5 block text-xs">
                                {option.instructions}
                              </span>
                            )
                          )}
                        </span>
                        {selected && (
                          <CheckCircle2
                            className="h-5 w-5 shrink-0 text-red-800 dark:text-red-300"
                            aria-hidden="true"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="card p-4 sm:p-5">
              <h2 className="text-theme-text-primary mb-3.5 text-[15px] font-bold">Pickup or shipping</h2>

              {bothFulfilments ? (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label
                    className={`${TILE_BASE} ${
                      fulfillmentMethod === StoreFulfillmentMethod.PICKUP ? TILE_SELECTED : TILE_IDLE
                    }`}
                  >
                    <input
                      type="radio"
                      name="fulfilment"
                      className="sr-only"
                      value={StoreFulfillmentMethod.PICKUP}
                      checked={fulfillmentMethod === StoreFulfillmentMethod.PICKUP}
                      onChange={() => setFulfillmentMethod(StoreFulfillmentMethod.PICKUP)}
                    />
                    {pickupTile}
                  </label>
                  <label
                    className={`${TILE_BASE} ${
                      fulfillmentMethod === StoreFulfillmentMethod.SHIP ? TILE_SELECTED : TILE_IDLE
                    }`}
                  >
                    <input
                      type="radio"
                      name="fulfilment"
                      className="sr-only"
                      value={StoreFulfillmentMethod.SHIP}
                      checked={fulfillmentMethod === StoreFulfillmentMethod.SHIP}
                      onChange={() => setFulfillmentMethod(StoreFulfillmentMethod.SHIP)}
                    />
                    {shipTile}
                  </label>
                </div>
              ) : (
                // One option is not a choice. Presented as a choice it invites
                // a member to hunt for the alternative that is not there.
                <div className={`${TILE_BASE} border-theme-surface-border border`}>
                  {fulfillmentMethod === StoreFulfillmentMethod.SHIP ? shipTile : pickupTile}
                </div>
              )}

              {fulfillmentMethod === StoreFulfillmentMethod.SHIP && (
                <div className="mt-3.5">
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

              <div className="mt-3.5">
                <label htmlFor="checkout-notes" className="form-label">
                  Notes for the quartermaster (optional)
                </label>
                <textarea
                  id="checkout-notes"
                  rows={2}
                  value={memberNotes}
                  onChange={(e) => setMemberNotes(e.target.value)}
                  className="form-input"
                  placeholder="Anything the quartermaster should know"
                />
              </div>
            </section>
          </div>

          <div className="lg:sticky lg:top-4 lg:col-span-1 lg:self-start">
            <section className="card flex flex-col gap-2.5 p-4 sm:p-5">
              <h2 className="text-theme-text-primary text-[15px] font-bold">Order summary</h2>
              <dl className="flex flex-col gap-2.5">
                <div className="flex justify-between text-sm">
                  <dt className="text-theme-text-secondary">Subtotal</dt>
                  <dd className="text-theme-text-primary font-mono">{formatCurrency(totals.subtotal)}</dd>
                </div>
                {embroidery > 0 && (
                  <div className="flex justify-between text-sm">
                    <dt className="text-theme-text-secondary">Embroidery</dt>
                    <dd className="text-theme-text-secondary font-mono">included</dd>
                  </div>
                )}
                {totals.tax > 0 && (
                  <div className="flex justify-between text-sm">
                    <dt className="text-theme-text-secondary">Tax</dt>
                    <dd className="text-theme-text-primary font-mono">{formatCurrency(totals.tax)}</dd>
                  </div>
                )}
                {totals.shipping > 0 && (
                  <div className="flex justify-between text-sm">
                    <dt className="text-theme-text-secondary">Shipping</dt>
                    <dd className="text-theme-text-primary font-mono">{formatCurrency(totals.shipping)}</dd>
                  </div>
                )}
                <div className="border-theme-surface-border mt-1 flex justify-between border-t pt-2.5 text-lg font-bold">
                  <dt className="text-theme-text-primary">Total due</dt>
                  <dd className="text-theme-text-primary font-mono">{formatCurrency(totals.total)}</dd>
                </div>
              </dl>

              <p className="text-theme-text-secondary text-xs leading-relaxed">{vendorGate}</p>

              <button
                type="button"
                className="btn-primary mt-1 hidden min-h-[48px] w-full font-bold lg:block"
                disabled={isSubmitting}
                onClick={() => void handleSubmit()}
              >
                {isSubmitting ? 'Submitting…' : 'Submit order'}
              </button>
              <Link to="/store" className="btn-secondary btn-md hidden w-full text-center lg:block">
                Back to cart
              </Link>

              {storefront?.termsText && (
                <p className="text-theme-text-secondary text-xs whitespace-pre-line">{storefront.termsText}</p>
              )}
            </section>
          </div>
        </div>
      </div>

      <div className="sticky-action-bar flex items-center gap-3 lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-theme-text-secondary text-xs">Total due</p>
          <p className="text-theme-text-primary font-mono text-[19px] font-bold">{formatCurrency(totals.total)}</p>
        </div>
        <button
          type="button"
          className="btn-primary min-h-[48px] px-6 font-bold"
          disabled={isSubmitting}
          onClick={() => void handleSubmit()}
        >
          {isSubmitting ? 'Submitting…' : 'Submit order'}
        </button>
      </div>
    </div>
  );
};

export default CheckoutPage;
