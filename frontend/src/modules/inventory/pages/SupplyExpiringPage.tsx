/**
 * Supply Officer — Expiring Items
 *
 * Shows checklist items deployed on apparatus that are expiring soon (or
 * already expired), alongside the ready replacement stock on hand for each.
 * A supply officer can filter/sort the worklist and add replacement stock
 * inline without leaving the page.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  PackageCheck,
  PackagePlus,
  PackageX,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type { SupplyExpiringItem } from '../../../modules/inventory/types/equipmentCheck';
import { inventoryService } from '../../../services/inventoryService';
import type { InventoryLotCreate } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { useOverlaySurface } from '../../../hooks/useOverlaySurface';
import { useAuthStore } from '../../../stores/authStore';
import { Breadcrumbs } from '../../../components/ux';
import { DialogPanel } from '../../../components/ux/DialogPanel';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';

const WINDOW_OPTIONS = [30, 60, 90];

type Filter = 'all' | 'restock' | 'reported' | 'expired';
type SortBy = 'soonest' | 'apparatus';

const FILTER_PREDICATES: Record<Filter, (item: SupplyExpiringItem) => boolean> = {
  all: () => true,
  restock: (i) => i.readyStock <= 0,
  reported: (i) => Boolean(i.restockNeeded || i.isShort),
  expired: (i) => i.isExpired,
};

const FILTERS: { key: Filter; label: string; tone: string }[] = [
  { key: 'all', label: 'All', tone: '' },
  { key: 'restock', label: 'Needs restock', tone: 'text-red-700 dark:text-red-400' },
  { key: 'reported', label: 'Used or short', tone: 'text-amber-700 dark:text-amber-400' },
  { key: 'expired', label: 'Expired', tone: 'text-red-700 dark:text-red-400' },
];

const shortDate = (date: string) => formatCalendarDate(date, { month: 'short', day: 'numeric', year: 'numeric' });

const GROUP_HEADING_CLASS =
  'bg-theme-bg text-theme-text-primary mobile-header-inset sticky z-10 py-1.5 text-sm font-semibold md:top-0';

function emptyLotForm(): InventoryLotCreate {
  return { lot_number: '', expiration_date: '', quantity: 1, received_date: '', notes: '' };
}

const SupplyExpiringPage: React.FC = () => {
  // Reading this worklist takes `inventory.check_view` (or `inventory.manage`),
  // and the hub card offers it on the narrower grant on purpose — knowing what
  // is about to expire is the checklist officer's business. Adding stock is
  // not: `POST /inventory/items/{id}/lots` is `inventory.manage`, so the
  // control is gated on that rather than on whatever opened the page.
  const canManageStock = useAuthStore((state) => state.checkPermission)('inventory.manage');
  const [daysAhead, setDaysAhead] = useState(30);
  const [items, setItems] = useState<SupplyExpiringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('soonest');

  // Inline add-stock modal
  const [stockTarget, setStockTarget] = useState<SupplyExpiringItem | null>(null);

  // Takes the fixed mobile bottom bar off this overlay while it is open.
  useOverlaySurface(Boolean(stockTarget));
  const [lotForm, setLotForm] = useState<InventoryLotCreate>(emptyLotForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    try {
      const overview = await equipmentCheckService.getSupplyExpiringItems(window);
      setItems(overview.items);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load expiring items'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(daysAhead);
  }, [daysAhead, load]);

  const [openLots, setOpenLots] = useState<Set<string>>(() => new Set());
  const toggleLots = (id: string) =>
    setOpenLots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // One predicate per chip, so a chip's count and the list it opens are the
  // same filter and cannot disagree.
  const counts = useMemo(
    () =>
      Object.fromEntries(FILTERS.map((f) => [f.key, items.filter(FILTER_PREDICATES[f.key]).length])) as Record<
        Filter,
        number
      >,
    [items]
  );

  const visibleItems = useMemo(() => {
    const list = items.filter(FILTER_PREDICATES[filter]);

    const sorted = [...list];
    if (sortBy === 'apparatus') {
      sorted.sort((a, b) => {
        const an = a.apparatusName || 'zzz';
        const bn = b.apparatusName || 'zzz';
        if (an !== bn) return an.localeCompare(bn);
        return (a.daysUntilExpiration ?? 0) - (b.daysUntilExpiration ?? 0);
      });
    } else {
      // Soonest first (expired items sort to the top via negative days).
      sorted.sort((a, b) => (a.daysUntilExpiration ?? 0) - (b.daysUntilExpiration ?? 0));
    }
    return sorted;
  }, [items, filter, sortBy]);

  /** By-apparatus view: the sorted list cut into one run per rig. */
  const groups = useMemo(() => {
    const out: { name: string; items: SupplyExpiringItem[] }[] = [];
    for (const item of visibleItems) {
      const name = item.apparatusName || 'No apparatus';
      const last = out[out.length - 1];
      if (last && last.name === name) last.items.push(item);
      else out.push({ name, items: [item] });
    }
    return out;
  }, [visibleItems]);

  const openAddStock = (item: SupplyExpiringItem) => {
    if (!canManageStock) return;
    setStockTarget(item);
    setLotForm({
      ...emptyLotForm(),
      lot_number: '',
      quantity: 1,
    });
  };

  const submitAddStock = async () => {
    if (!canManageStock) return;
    if (!stockTarget?.inventoryItemId) return;
    if (lotForm.quantity == null || lotForm.quantity < 1) {
      toast.error('Enter a quantity of at least 1');
      return;
    }
    setSaving(true);
    try {
      await inventoryService.addItemLot(stockTarget.inventoryItemId, {
        lot_number: lotForm.lot_number?.trim() || undefined,
        expiration_date: lotForm.expiration_date || undefined,
        quantity: Number(lotForm.quantity),
        received_date: lotForm.received_date || undefined,
        notes: lotForm.notes?.trim() || undefined,
      });
      toast.success('Stock added');
      setStockTarget(null);
      void load(daysAhead);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add stock'));
    } finally {
      setSaving(false);
    }
  };

  const renderItem = (item: SupplyExpiringItem) => {
    const days = item.daysUntilExpiration;
    const lotsOpen = openLots.has(item.templateItemId);
    const details = [
      item.apparatusName && sortBy !== 'apparatus' ? item.apparatusName : null,
      item.compartmentName ?? null,
      item.expirationDate ? `exp ${shortDate(item.expirationDate)}` : null,
      item.lotNumber ? `lot ${item.lotNumber}` : null,
    ].filter((part): part is string => Boolean(part));
    return (
      <li
        key={item.templateItemId}
        className={`rounded-lg border px-3 py-2.5 ${
          item.isExpired
            ? 'border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10'
            : 'border-theme-surface-border bg-theme-surface'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-theme-text-primary min-w-0 font-semibold">{item.itemName}</span>
          {item.isExpired ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Expired
            </span>
          ) : days != null && days <= daysAhead ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {days}d left
            </span>
          ) : null}
        </div>
        {details.length > 0 && <p className="text-theme-text-muted mt-0.5 text-xs">{details.join(' · ')}</p>}
        {/* A crew's report is the other way onto this list, and it has no
            date to explain why the row is here. The count is the point of
            the second badge: a box down to its last unit and one just opened
            are both "needs restock" without it, and they are not the same
            job. */}
        {(item.restockNeeded || (item.isShort && item.targetQuantity != null)) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {item.restockNeeded && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                <PackageX className="h-3 w-3" aria-hidden="true" /> Reported used
              </span>
            )}
            {item.isShort && item.targetQuantity != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                {item.quantityOnTruck ?? 0} of {item.targetQuantity} aboard
              </span>
            )}
          </div>
        )}
        {item.restockNeeded && item.restockNote && (
          <p className="text-theme-text-muted mt-1 text-xs italic">&ldquo;{item.restockNote}&rdquo;</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            {item.readyStock > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-green-700 dark:text-green-400">
                <PackageCheck className="h-4 w-4" aria-hidden="true" /> {item.readyStock} ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-red-700 dark:text-red-400">
                <PackageX className="h-4 w-4" aria-hidden="true" /> No stock
              </span>
            )}
            {item.readyLots.length > 0 && (
              <button
                type="button"
                onClick={() => toggleLots(item.templateItemId)}
                aria-expanded={lotsOpen}
                className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 inline-flex items-center gap-0.5 text-xs whitespace-nowrap"
              >
                {item.readyLots.length} {item.readyLots.length === 1 ? 'lot' : 'lots'}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${lotsOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
            )}
          </div>
          {item.inventoryItemId ? (
            <div className="flex shrink-0 items-center gap-2">
              {/* Disabled rather than hidden, as on the apparatus inventory
                  screen: this worklist exists to say what needs restocking, so
                  a viewer who cannot do it is better told who does than left
                  looking for a control that is not there. */}
              <button
                type="button"
                disabled={!canManageStock}
                onClick={() => openAddStock(item)}
                title={canManageStock ? undefined : 'Replacement stock is added by the quartermaster'}
                className="touch:min-h-11 inline-flex items-center gap-1 rounded-lg border border-blue-600/40 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-400"
              >
                {/* "Add" alone on a phone, where the row also carries the
                    stock count and the lots toggle. The space sits outside the
                    span: accessible-name computation trims each node, and
                    inside it the name read "Addstock". */}
                <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" /> Add{' '}
                <span className="max-sm:sr-only">stock</span>
              </button>
              <Link
                to={`/inventory/items/${item.inventoryItemId}`}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 inline-flex items-center gap-0.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
              >
                Manage
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <span className="text-theme-text-muted text-[11px] italic">Not linked to inventory</span>
          )}
        </div>

        {lotsOpen && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.readyLots.map((lot) => (
              <span
                key={lot.id}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${
                  lot.isExpired
                    ? 'border-red-500/30 bg-red-500/10 text-red-700 line-through dark:text-red-400'
                    : 'border-theme-surface-border bg-theme-surface-secondary text-theme-text-muted'
                }`}
                // Expired shelf stock is shown so it can be pulled and
                // disposed of, but it is excluded from the ready count and
                // refused by the swap — it is not a replacement.
                title={lot.isExpired ? 'Expired — cannot be deployed' : undefined}
              >
                {lot.lotNumber || 'No lot'} · {lot.quantity}×
                {lot.expirationDate ? ` · ${shortDate(lot.expirationDate)}` : ''}
                {lot.isExpired ? ' · expired' : ''}
              </span>
            ))}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
      {/* No back link of its own, and reachable by a scheduling officer holding
          no inventory grant beyond this route's — so the trail drops the
          Inventory crumbs it cannot open and keeps the rest. On a phone it is
          one link up, to the nearest of those. */}
      <Breadcrumbs className="mb-0" compactOnPhone />

      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-theme-text-primary text-xl font-bold sm:text-2xl">Expiring on Apparatus</h1>
          <div
            className="border-theme-surface-border flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
            role="group"
            aria-label="Look ahead"
          >
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDaysAhead(w)}
                aria-pressed={daysAhead === w}
                className={`touch:min-h-10 rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                  daysAhead === w ? 'bg-red-800 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                {w}d
              </button>
            ))}
          </div>
        </div>
        <p className="text-theme-text-muted mt-0.5 text-sm">
          Nearing expiry or reported used on the trucks, with the replacement stock for each.
        </p>
      </div>

      {!loading && items.length > 0 && (
        <div className="space-y-2">
          {/* The counts are the filters: a separate row of totals said "2 need
              restock" and left the officer to find the chip that showed them. */}
          <div className="min-w-0">
            <ScrollCueRow className="flex gap-2" data-mobile-scroll-region role="group" aria-label="Filter items">
              {FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0 || filter === f.key).map((f) => {
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(active || f.key === 'all' ? 'all' : f.key)}
                    className={`touch-target-phone flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors ${
                      active
                        ? 'border-theme-text-primary bg-theme-surface-secondary text-theme-text-primary'
                        : `border-theme-surface-border hover:bg-theme-surface-hover ${f.tone || 'text-theme-text-muted'}`
                    }`}
                  >
                    {f.label} <span className="font-bold tabular-nums">{counts[f.key]}</span>
                  </button>
                );
              })}
            </ScrollCueRow>
          </div>
          <div className="text-theme-text-muted flex items-center gap-2 text-sm">
            <span id="supply-sort-label">Sort</span>
            <div
              className="border-theme-surface-border flex items-center gap-0.5 rounded-lg border p-0.5"
              role="group"
              aria-labelledby="supply-sort-label"
            >
              {(
                [
                  ['soonest', 'Soonest'],
                  ['apparatus', 'By apparatus'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortBy(key)}
                  aria-pressed={sortBy === key}
                  className={`touch:min-h-10 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    sortBy === key
                      ? 'bg-theme-surface-secondary text-theme-text-primary'
                      : 'hover:text-theme-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-7 w-7 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="border-theme-surface-border rounded-lg border border-dashed p-10 text-center">
          <PackageCheck className="mx-auto mb-3 h-10 w-10 text-green-500" />
          <p className="text-theme-text-muted text-sm">
            Nothing expiring in the next {daysAhead} days. All stocked up.
          </p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="border-theme-surface-border text-theme-text-muted rounded-lg border border-dashed p-8 text-center text-sm">
          No items match this filter.
        </div>
      ) : sortBy === 'apparatus' ? (
        <div className="space-y-3">
          {groups.map((group) => (
            <section key={group.name} aria-label={group.name} className="space-y-2">
              {/* Pinned below the fixed mobile header (top-0 from 768px) on an
                  opaque layer, so a long rig keeps saying which rig it is. */}
              <h2 className={GROUP_HEADING_CLASS}>
                {group.name}{' '}
                <span className="text-theme-text-muted font-normal">
                  · {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                </span>
              </h2>
              <ul className="space-y-2">{group.items.map(renderItem)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">{visibleItems.map(renderItem)}</ul>
      )}

      {/* Add-stock sheet */}
      {stockTarget && (
        <div
          className="modal-overlay z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-stock-title"
        >
          <DialogPanel
            onClose={() => setStockTarget(null)}
            className="bg-theme-surface-modal border-theme-surface-border modal-panel-scroll w-full rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl"
          >
            <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h3 id="add-stock-title" className="text-theme-text-primary text-sm font-semibold">
                  Add ready stock
                </h3>
                <p className="text-theme-text-muted truncate text-xs">{stockTarget.itemName}</p>
              </div>
              <button
                type="button"
                data-dialog-close
                onClick={() => setStockTarget(null)}
                className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target flex items-center justify-center"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              {/* What is aboard now, so the new lot can be checked against the
                  one it replaces before it is entered. */}
              {(stockTarget.apparatusName || stockTarget.lotNumber || stockTarget.expirationDate) && (
                <p className="bg-theme-surface-secondary text-theme-text-secondary rounded-lg px-3 py-2 text-xs">
                  <span className="text-theme-text-muted">On the truck now: </span>
                  {[
                    stockTarget.apparatusName,
                    stockTarget.lotNumber ? `lot ${stockTarget.lotNumber}` : null,
                    stockTarget.expirationDate
                      ? `${stockTarget.isExpired ? 'expired' : 'exp'} ${shortDate(stockTarget.expirationDate)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-stock-qty" className="form-label">
                    Quantity
                  </label>
                  <input
                    id="add-stock-qty"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    className="form-input"
                    value={lotForm.quantity}
                    onChange={(e) => setLotForm((p) => ({ ...p, quantity: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label htmlFor="add-stock-lot" className="form-label">
                    Lot Number
                  </label>
                  <input
                    id="add-stock-lot"
                    type="text"
                    className="form-input"
                    placeholder="LOT-4823"
                    value={lotForm.lot_number ?? ''}
                    onChange={(e) => setLotForm((p) => ({ ...p, lot_number: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="add-stock-exp" className="form-label">
                    Expiration
                  </label>
                  <input
                    id="add-stock-exp"
                    type="date"
                    className="form-input"
                    value={lotForm.expiration_date ?? ''}
                    onChange={(e) => setLotForm((p) => ({ ...p, expiration_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="add-stock-received" className="form-label">
                    Received
                  </label>
                  <input
                    id="add-stock-received"
                    type="date"
                    className="form-input"
                    value={lotForm.received_date ?? ''}
                    onChange={(e) => setLotForm((p) => ({ ...p, received_date: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="bg-theme-surface-modal border-theme-surface-border sticky bottom-0 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                disabled={saving}
                onClick={() => void submitAddStock()}
                className="btn-primary inline-flex w-full items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                Add stock
              </button>
            </div>
          </DialogPanel>
        </div>
      )}
    </div>
  );
};

export default SupplyExpiringPage;
