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
  Clock,
  Loader2,
  PackageCheck,
  PackageX,
  PackagePlus,
  Truck,
  ChevronRight,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { SupplyExpiringItem } from '../../modules/scheduling/types/equipmentCheck';
import { inventoryService } from '../../services/inventoryService';
import type { InventoryLotCreate } from '../../services/eventServices';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

const WINDOW_OPTIONS = [30, 60, 90];

type Filter = 'all' | 'restock' | 'reported' | 'expired';
type SortBy = 'soonest' | 'apparatus';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'restock', label: 'Needs restock' },
  { key: 'reported', label: 'Used or short' },
  { key: 'expired', label: 'Expired' },
];

function emptyLotForm(): InventoryLotCreate {
  return { lot_number: '', expiration_date: '', quantity: 1, received_date: '', notes: '' };
}

const SupplyExpiringPage: React.FC = () => {
  const tz = useTimezone();
  const [daysAhead, setDaysAhead] = useState(30);
  const [items, setItems] = useState<SupplyExpiringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('soonest');

  // Inline add-stock modal
  const [stockTarget, setStockTarget] = useState<SupplyExpiringItem | null>(null);
  const [lotForm, setLotForm] = useState<InventoryLotCreate>(emptyLotForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    try {
      const overview = await schedulingService.getSupplyExpiringItems(window);
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

  const withStock = items.filter((i) => i.readyStock > 0).length;
  const withoutStock = items.filter((i) => i.readyStock <= 0).length;

  const visibleItems = useMemo(() => {
    let list = items;
    if (filter === 'restock') list = list.filter((i) => i.readyStock <= 0);
    else if (filter === 'reported') list = list.filter((i) => i.restockNeeded || i.isShort);
    else if (filter === 'expired') list = list.filter((i) => i.isExpired);

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

  const openAddStock = (item: SupplyExpiringItem) => {
    setStockTarget(item);
    setLotForm({
      ...emptyLotForm(),
      lot_number: '',
      quantity: 1,
    });
  };

  const submitAddStock = async () => {
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Expiring on Apparatus</h1>
          <p className="text-theme-text-muted mt-0.5 text-sm">
            Items nearing expiration on the trucks, plus anything a crew has reported used, with the ready replacement
            stock for each.
          </p>
        </div>
        <div className="border-theme-surface-border flex items-center gap-1 rounded-lg border p-1">
          {WINDOW_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDaysAhead(w)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                daysAhead === w ? 'bg-blue-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {!loading && items.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="bg-theme-surface border-theme-surface-border text-theme-text-muted inline-flex items-center gap-1.5 rounded-full border px-3 py-1">
              <Clock className="h-4 w-4" /> {items.length} needing attention
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <PackageCheck className="h-4 w-4" /> {withStock} with ready stock
            </span>
            {withoutStock > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                <PackageX className="h-4 w-4" /> {withoutStock} need restock
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="tab-scroll border-theme-surface-border flex items-center gap-1 rounded-lg border p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors ${
                    filter === f.key
                      ? 'bg-theme-surface-secondary text-theme-text-primary'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className="text-theme-text-muted flex items-center gap-2 text-sm">
              Sort
              <select
                className="form-input py-1 text-sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
              >
                <option value="soonest">Soonest expiry</option>
                <option value="apparatus">By apparatus</option>
              </select>
            </label>
          </div>
        </>
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
      ) : (
        <ul className="space-y-2">
          {visibleItems.map((item) => {
            const days = item.daysUntilExpiration;
            return (
              <li
                key={item.templateItemId}
                className={`rounded-lg border p-4 ${
                  item.isExpired
                    ? 'border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10'
                    : 'border-theme-surface-border bg-theme-surface'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-theme-text-primary font-semibold">{item.itemName}</span>
                      {item.isExpired && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          <AlertTriangle className="h-3 w-3" /> Expired
                        </span>
                      )}
                      {!item.isExpired && days != null && days <= daysAhead && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                          <Clock className="h-3 w-3" />
                          {days}d left
                        </span>
                      )}
                      {/* A crew's report is the other way onto this list, and
                          it has no date to explain why the row is here. */}
                      {item.restockNeeded && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                          <PackageX className="h-3 w-3" /> Reported used
                        </span>
                      )}
                      {/* The number is the point: a box down to its last unit
                          and one just opened are both "needs restock" without
                          it, and they are not the same job. */}
                      {item.isShort && item.targetQuantity != null && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                          {item.quantityOnTruck ?? 0} of {item.targetQuantity} aboard
                        </span>
                      )}
                    </div>
                    <div className="text-theme-text-muted mt-1 flex flex-wrap items-center gap-2 text-xs">
                      {item.apparatusName && (
                        <span className="inline-flex items-center gap-1">
                          <Truck className="h-3 w-3" /> {item.apparatusName}
                        </span>
                      )}
                      {item.compartmentName && <span>· {item.compartmentName}</span>}
                      {item.expirationDate && <span>· Exp {formatDate(item.expirationDate, tz)}</span>}
                      {item.lotNumber && <span>· Lot {item.lotNumber}</span>}
                    </div>
                    {item.restockNeeded && item.restockNote && (
                      <p className="text-theme-text-muted mt-1 text-xs italic">&ldquo;{item.restockNote}&rdquo;</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {item.readyStock > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <PackageCheck className="h-4 w-4" /> {item.readyStock} ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        <PackageX className="h-4 w-4" /> No stock
                      </span>
                    )}
                    {item.inventoryItemId ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openAddStock(item)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          <PackagePlus className="h-3.5 w-3.5" /> Add stock
                        </button>
                        <Link
                          to={`/inventory/items/${item.inventoryItemId}`}
                          className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-0.5 text-xs"
                        >
                          Manage
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </div>
                    ) : (
                      <span className="text-theme-text-muted text-[11px] italic">Not linked to inventory</span>
                    )}
                  </div>
                </div>
                {item.readyLots.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.readyLots.map((lot) => (
                      <span
                        key={lot.id}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${
                          lot.isExpired
                            ? 'border-red-500/30 bg-red-500/10 text-red-700 line-through dark:text-red-400'
                            : 'border-theme-surface-border bg-theme-surface-secondary text-theme-text-muted'
                        }`}
                        // Expired shelf stock is shown so it can be pulled and
                        // disposed of, but it is excluded from the ready count
                        // and refused by the swap — it is not a replacement.
                        title={lot.isExpired ? 'Expired — cannot be deployed' : undefined}
                      >
                        {lot.lotNumber || 'No lot'} · {lot.quantity}×
                        {lot.expirationDate ? ` · ${formatDate(lot.expirationDate, tz)}` : ''}
                        {lot.isExpired ? ' · expired' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Inline add-stock modal */}
      {stockTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
          <div className="bg-theme-surface border-theme-surface-border w-full rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl">
            <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-theme-text-primary text-sm font-semibold">Add ready stock</h3>
                <p className="text-theme-text-muted truncate text-xs">{stockTarget.itemName}</p>
              </div>
              <button
                type="button"
                onClick={() => setStockTarget(null)}
                className="text-theme-text-muted hover:text-theme-text-primary p-1.5"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Lot Number</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. LOT-4823"
                    value={lotForm.lot_number ?? ''}
                    onChange={(e) => setLotForm((p) => ({ ...p, lot_number: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    className="form-input"
                    value={lotForm.quantity}
                    onChange={(e) => setLotForm((p) => ({ ...p, quantity: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="form-label">Expiration</label>
                  <input
                    type="date"
                    className="form-input"
                    value={lotForm.expiration_date ?? ''}
                    onChange={(e) => setLotForm((p) => ({ ...p, expiration_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Received</label>
                  <input
                    type="date"
                    className="form-input"
                    value={lotForm.received_date ?? ''}
                    onChange={(e) => setLotForm((p) => ({ ...p, received_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submitAddStock()}
                  className="btn-primary btn-sm inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                  Add stock
                </button>
                <button type="button" onClick={() => setStockTarget(null)} className="btn-secondary btn-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplyExpiringPage;
