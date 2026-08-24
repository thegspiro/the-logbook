/**
 * Storefront Page
 *
 * Member-facing store: browse what the open order window offers, build a cart,
 * and go to checkout. Prices shown here are advisory — the server reprices
 * every line at submit, so the confirmation is the authoritative receipt.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CalendarClock, Package, Search, ShoppingBag, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { formatCurrency } from '../../../utils/dateFormatting';
import { StoreCartPanel } from '../components/StoreCartPanel';
import { StoreProductCard } from '../components/StoreProductCard';
import { StoreWindowCard } from '../components/StoreWindowCard';
import { computeCartTotals, useStorefrontStore } from '../store/storefrontStore';
import type { StorefrontProductOffer } from '../types';

const ALL_CATEGORIES = '__all__';

const CHIP_BASE =
  'focus-visible:ring-theme-focus-ring shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-hidden';
const CHIP_ACTIVE = 'bg-slate-900 text-white dark:bg-white dark:text-slate-900';
const CHIP_IDLE =
  'bg-theme-surface border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover border';

/** Search matches what the member can actually see on a card. */
const matchesSearch = (offer: StorefrontProductOffer, term: string): boolean => {
  if (!term) return true;
  const needle = term.toLowerCase();
  return offer.name.toLowerCase().includes(needle) || (offer.description ?? '').toLowerCase().includes(needle);
};

const StorefrontPage: React.FC = () => {
  const navigate = useNavigate();
  const { storefront, cart, isLoading, error, loadStorefront, addToCart, updateCartQuantity, removeFromCart } =
    useStorefrontStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);

  useEffect(() => {
    void loadStorefront();
  }, [loadStorefront]);

  // A category chip is only meaningful against the catalog it was drawn from.
  // Switching windows keeps a stale filter selected, which shows the new
  // window's catalog as empty — a store that looks unstocked, not filtered.
  const windowId = storefront?.window?.id;
  useEffect(() => {
    setActiveCategory(ALL_CATEGORIES);
    setSearchTerm('');
  }, [windowId]);

  const products = useMemo(() => storefront?.products ?? [], [storefront]);

  /** Category counts are taken before the search filter: a chip reading
   *  "Apparel 0" because of what is typed in the box is noise, not a count. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const offer of products) {
      if (!offer.category) continue;
      counts.set(offer.category, (counts.get(offer.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products]);

  const visibleProducts = useMemo(
    () =>
      products.filter(
        (offer) =>
          (activeCategory === ALL_CATEGORIES || offer.category === activeCategory) &&
          matchesSearch(offer, searchTerm.trim())
      ),
    [activeCategory, products, searchTerm]
  );

  // Shipping is chosen at checkout, so the cart quotes the pickup price. The
  // summary on the checkout page is where a shipping line can appear.
  const totals = useMemo(
    () => computeCartTotals(cart, Number(storefront?.taxRate ?? 0), 0),
    [cart, storefront?.taxRate]
  );

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const goToCheckout = useCallback(() => {
    void navigate('/store/checkout');
  }, [navigate]);

  if (isLoading && !storefront) {
    return <SkeletonPage />;
  }

  // Checked before the "store is closed" branch below: a failed load leaves
  // `storefront` null, which that branch reads as a deliberate department
  // decision and states as one. A member told the store is closed does not
  // retry.
  if (error && !storefront) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-10 sm:px-6">
        <p className="alert-danger" role="alert">
          {error}
        </p>
        <button type="button" onClick={() => void loadStorefront()} className="btn-secondary btn-md">
          Try again
        </button>
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
    <div className="motion-safe:animate-page-enter min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-800">
              <Store className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-theme-text-primary truncate text-[22px] font-bold">{storefront.storeName}</h1>
              {storefront.tagline && <p className="text-theme-text-secondary text-sm">{storefront.tagline}</p>}
            </div>
          </div>
          <Link to="/store/orders" className="btn-secondary btn-md btn-auto shrink-0">
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">My orders</span>
            <span className="sm:hidden">Orders</span>
          </Link>
        </div>

        <StoreWindowCard storefront={storefront} onSelectWindow={(windowId) => void loadStorefront(windowId)} />

        {products.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:flex-1">
              <Search
                className="text-theme-text-secondary pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <label htmlFor="catalog-search" className="sr-only">
                Search the catalog
              </label>
              <input
                id="catalog-search"
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search the catalog"
                className="form-input pr-4 pl-10 text-sm"
              />
            </div>
            {categories.length > 0 && (
              <div className="hscroll flex gap-2" role="group" aria-label="Filter by category">
                <button
                  type="button"
                  aria-pressed={activeCategory === ALL_CATEGORIES}
                  onClick={() => setActiveCategory(ALL_CATEGORIES)}
                  className={`${CHIP_BASE} ${activeCategory === ALL_CATEGORIES ? CHIP_ACTIVE : CHIP_IDLE}`}
                >
                  All {products.length}
                </button>
                {categories.map(([category, count]) => (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={activeCategory === category}
                    onClick={() => setActiveCategory(category)}
                    className={`${CHIP_BASE} ${activeCategory === category ? CHIP_ACTIVE : CHIP_IDLE}`}
                  >
                    {category} {count}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {products.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Nothing listed yet"
                description="This order window doesn't have any items posted."
              />
            ) : visibleProducts.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Nothing matches that"
                description="Try a different search term, or clear the category filter."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {visibleProducts.map((offer) => (
                  <StoreProductCard
                    key={offer.id}
                    offer={offer}
                    onAdd={(variantId, quantity, personalizationText) => {
                      addToCart(offer, variantId, quantity, personalizationText);
                      toast.success(`${offer.name} added to cart`);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-4 lg:col-span-1 lg:self-start">
            <StoreCartPanel
              cart={cart}
              totals={totals}
              paymentMethods={storefront.paymentMethods ?? []}
              onUpdateQuantity={(line, quantity) =>
                updateCartQuantity(line.productId, line.variantId, quantity, line.personalizationText)
              }
              onRemove={(line) => removeFromCart(line.productId, line.variantId, line.personalizationText)}
              onReview={goToCheckout}
            />
          </div>
        </div>
      </div>

      {/* Phone shortcut to checkout. The panel above still carries the full
          cart; this is the running total following the member down the page,
          which on a phone is otherwise several screens behind them. */}
      {cart.length > 0 && (
        <div className="sticky-action-bar flex items-center gap-3 lg:hidden">
          <div className="min-w-0 flex-1">
            <p className="text-theme-text-secondary text-xs">
              {itemCount} {itemCount === 1 ? 'item' : 'items'} in cart
            </p>
            <p className="text-theme-text-primary font-mono text-[19px] font-bold">{formatCurrency(totals.total)}</p>
          </div>
          <button type="button" className="btn-primary min-h-[48px] px-6 font-bold" onClick={goToCheckout}>
            Review
          </button>
        </div>
      )}
    </div>
  );
};

export default StorefrontPage;
