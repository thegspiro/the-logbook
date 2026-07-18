/**
 * Supply Officer — Expiring Items
 *
 * Shows checklist items deployed on apparatus that are expiring soon (or
 * already expired), alongside the ready replacement stock on hand for each.
 * A supply officer can filter/sort the worklist and add replacement stock
 * inline without leaving the page.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
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

type Filter = 'all' | 'restock' | 'expired';
type SortBy = 'soonest' | 'apparatus';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'restock', label: 'Needs restock' },
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
      sorted.sort(
        (a, b) => (a.daysUntilExpiration ?? 0) - (b.daysUntilExpiration ?? 0),
      );
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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Expiring on Apparatus</h1>
          <p className="text-sm text-theme-text-muted mt-0.5">
            Items nearing expiration on the trucks, with ready replacement stock.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-theme-surface-border p-1">
          {WINDOW_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDaysAhead(w)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                daysAhead === w
                  ? 'bg-blue-600 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-theme-surface border border-theme-surface-border px-3 py-1 text-theme-text-muted">
              <Clock className="w-4 h-4" /> {items.length} expiring
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-3 py-1">
              <PackageCheck className="w-4 h-4" /> {withStock} with ready stock
            </span>
            {withoutStock > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-3 py-1">
                <PackageX className="w-4 h-4" /> {withoutStock} need restock
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="tab-scroll flex items-center gap-1 rounded-lg border border-theme-surface-border p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    filter === f.key
                      ? 'bg-theme-surface-secondary text-theme-text-primary'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-theme-text-muted">
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
          <Loader2 className="w-7 h-7 animate-spin text-theme-text-muted" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-theme-surface-border p-10 text-center">
          <PackageCheck className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="text-sm text-theme-text-muted">
            Nothing expiring in the next {daysAhead} days. All stocked up.
          </p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-theme-surface-border p-8 text-center text-sm text-theme-text-muted">
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
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-theme-text-primary">{item.itemName}</span>
                      {item.isExpired ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          <AlertTriangle className="w-3 h-3" /> Expired
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                          <Clock className="w-3 h-3" />
                          {days != null ? `${days}d left` : 'Expiring'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-theme-text-muted mt-1 flex-wrap">
                      {item.apparatusName && (
                        <span className="inline-flex items-center gap-1">
                          <Truck className="w-3 h-3" /> {item.apparatusName}
                        </span>
                      )}
                      {item.compartmentName && <span>· {item.compartmentName}</span>}
                      {item.expirationDate && (
                        <span>· Exp {formatDate(item.expirationDate, tz)}</span>
                      )}
                      {item.lotNumber && <span>· Lot {item.lotNumber}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    {item.readyStock > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-3 py-1 text-sm font-medium">
                        <PackageCheck className="w-4 h-4" /> {item.readyStock} ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-3 py-1 text-sm font-medium">
                        <PackageX className="w-4 h-4" /> No stock
                      </span>
                    )}
                    {item.inventoryItemId ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openAddStock(item)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          <PackagePlus className="w-3.5 h-3.5" /> Add stock
                        </button>
                        <Link
                          to={`/inventory/items/${item.inventoryItemId}`}
                          className="inline-flex items-center gap-0.5 text-xs text-theme-text-muted hover:text-theme-text-primary"
                        >
                          Manage
                          <ChevronRight className="w-3 h-3" />
                        </Link>
                      </div>
                    ) : (
                      <span className="text-[11px] text-theme-text-muted italic">
                        Not linked to inventory
                      </span>
                    )}
                  </div>
                </div>
                {item.readyLots.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.readyLots.map((lot) => (
                      <span
                        key={lot.id}
                        className="inline-flex items-center gap-1 rounded-md border border-theme-surface-border bg-theme-surface-secondary px-2 py-0.5 text-[11px] text-theme-text-muted"
                      >
                        {lot.lotNumber || 'No lot'} · {lot.quantity}×
                        {lot.expirationDate ? ` · ${formatDate(lot.expirationDate, tz)}` : ''}
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-theme-surface rounded-t-2xl sm:rounded-2xl border border-theme-surface-border shadow-xl">
            <div className="flex items-center justify-between border-b border-theme-surface-border px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-theme-text-primary">Add ready stock</h3>
                <p className="text-xs text-theme-text-muted truncate">{stockTarget.itemName}</p>
              </div>
              <button
                type="button"
                onClick={() => setStockTarget(null)}
                className="p-1.5 text-theme-text-muted hover:text-theme-text-primary"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-4 py-4 space-y-3">
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
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <PackagePlus className="w-4 h-4" />
                  )}
                  Add stock
                </button>
                <button
                  type="button"
                  onClick={() => setStockTarget(null)}
                  className="btn-secondary btn-sm"
                >
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
