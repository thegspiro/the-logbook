/**
 * Storefront Cart Panel
 *
 * The running order: what is in it, what it comes to, and — before the member
 * commits to anything — the answer to "am I about to be charged?", which the
 * old cart left them to find out on the next screen.
 */

import React from 'react';
import { Info, Minus, Plus, ShoppingCart } from 'lucide-react';
import { formatCurrency } from '../../../utils/dateFormatting';
import { cartLineKey, cartLineMeta } from '../utils/cartLines';
import { productGlyph } from '../utils/productGlyph';
import type { CartLine, StorefrontPaymentMethodInfo } from '../types';

interface CartTotals {
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
}

interface StoreCartPanelProps {
  cart: CartLine[];
  totals: CartTotals;
  paymentMethods: StorefrontPaymentMethodInfo[];
  onUpdateQuantity: (line: CartLine, quantity: number) => void;
  onRemove: (line: CartLine) => void;
  onReview: () => void;
}

/**
 * Names only what the department has actually configured.
 *
 * Built from `paymentMethods`, not `acceptedPaymentMethods`: the latter is the
 * raw list of methods enabled in settings, and the backend drops any whose
 * handle is missing or malformed from both checkout and the post-order
 * instructions. Promising Venmo off the raw list therefore named a route that
 * checkout would not offer and the order could not explain.
 */
const paymentSentence = (methods: StorefrontPaymentMethodInfo[]): string => {
  const labels = methods.map((method) => method.label);
  if (labels.length === 0) {
    return 'Nothing is charged here. You’ll get payment instructions as soon as you submit.';
  }
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
  return `Nothing is charged here. You’ll get payment instructions — ${list} — as soon as you submit.`;
};

export const StoreCartPanel: React.FC<StoreCartPanelProps> = ({
  cart,
  totals,
  paymentMethods,
  onUpdateQuantity,
  onRemove,
  onReview,
}) => {
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="card overflow-hidden">
      <div className="border-theme-surface-border flex items-center gap-2 border-b px-4 pt-4 pb-3">
        <ShoppingCart className="text-theme-text-primary h-[18px] w-[18px]" aria-hidden="true" />
        <h2 className="text-theme-text-primary flex-1 text-[15px] font-bold">Your cart</h2>
        {itemCount > 0 && (
          <span className="badge bg-red-50 font-semibold text-red-900 dark:bg-red-500/15 dark:text-red-200">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>

      {cart.length === 0 ? (
        <p className="text-theme-text-secondary p-4 text-sm">Nothing in your cart yet.</p>
      ) : (
        <div className="flex flex-col gap-3.5 p-4">
          <ul className="flex flex-col gap-3.5">
            {cart.map((line) => {
              const Glyph = productGlyph({ name: line.productName });
              return (
                <li key={cartLineKey(line)} className="flex gap-3">
                  <div className="bg-theme-surface-hover flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
                    <Glyph className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <p className="text-theme-text-primary text-sm font-semibold">{line.productName}</p>
                      <span className="text-theme-text-primary font-mono text-sm whitespace-nowrap">
                        {formatCurrency(line.unitPrice * line.quantity)}
                      </span>
                    </div>
                    {cartLineMeta(line) && (
                      <p className="text-theme-text-secondary mt-0.5 text-xs">{cartLineMeta(line)}</p>
                    )}
                    {/* 28px stepper and a text Remove are the design's sidebar
                        sizes. Below md they grow to 44px: this row replaced a
                        44px icon button, and shrinking a control that already
                        met the touch minimum is a regression, not a redesign. */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="border-theme-surface-border flex items-center rounded-md border">
                        <button
                          type="button"
                          aria-label={`Decrease quantity of ${line.productName}`}
                          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex h-11 w-11 items-center justify-center md:h-7 md:w-7"
                          onClick={() => onUpdateQuantity(line, line.quantity - 1)}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-theme-text-primary w-6 text-center text-[13px]">{line.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Increase quantity of ${line.productName}`}
                          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex h-11 w-11 items-center justify-center md:h-7 md:w-7"
                          onClick={() => onUpdateQuantity(line, line.quantity + 1)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex min-h-[44px] items-center text-xs underline decoration-dotted md:min-h-0"
                        onClick={() => onRemove(line)}
                      >
                        Remove
                        <span className="sr-only"> {line.productName}</span>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <dl className="border-theme-surface-border flex flex-col gap-1.5 border-t pt-3">
            <div className="flex justify-between text-sm">
              <dt className="text-theme-text-secondary">Subtotal</dt>
              <dd className="text-theme-text-primary font-mono">{formatCurrency(totals.subtotal)}</dd>
            </div>
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
            <div className="flex justify-between pt-1.5 text-base font-bold">
              <dt className="text-theme-text-primary">Total</dt>
              <dd className="text-theme-text-primary font-mono">{formatCurrency(totals.total)}</dd>
            </div>
          </dl>

          <div className="alert-info flex gap-2.5 p-3">
            <Info className="text-theme-alert-info-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-theme-alert-info-title text-xs leading-relaxed">{paymentSentence(paymentMethods)}</p>
          </div>

          <button type="button" className="btn-primary min-h-[48px] w-full font-bold" onClick={onReview}>
            Review order · {formatCurrency(totals.total)}
          </button>
        </div>
      )}
    </div>
  );
};

export default StoreCartPanel;
