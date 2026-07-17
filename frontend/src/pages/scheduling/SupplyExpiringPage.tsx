/**
 * Supply Officer — Expiring Items
 *
 * Shows checklist items deployed on apparatus that are expiring soon (or
 * already expired), alongside the ready replacement stock on hand for each.
 * Lets a supply officer see at a glance what needs replacing and whether a
 * fresh unit is ready to swap onto the vehicle.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Clock,
  Loader2,
  PackageCheck,
  PackageX,
  Truck,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { SupplyExpiringItem } from '../../modules/scheduling/types/equipmentCheck';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

const WINDOW_OPTIONS = [30, 60, 90];

const SupplyExpiringPage: React.FC = () => {
  const tz = useTimezone();
  const [daysAhead, setDaysAhead] = useState(30);
  const [items, setItems] = useState<SupplyExpiringItem[]>([]);
  const [loading, setLoading] = useState(true);

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
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
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
                  <div className="shrink-0 text-right">
                    {item.readyStock > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-3 py-1 text-sm font-medium">
                        <PackageCheck className="w-4 h-4" /> {item.readyStock} ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-3 py-1 text-sm font-medium">
                        <PackageX className="w-4 h-4" /> No stock
                      </span>
                    )}
                    {item.inventoryItemId && (
                      <div className="mt-1">
                        <Link
                          to={`/inventory/items/${item.inventoryItemId}`}
                          className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-700"
                        >
                          {item.readyStock > 0 ? 'Manage stock' : 'Add stock'}
                          <ChevronRight className="w-3 h-3" />
                        </Link>
                      </div>
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
    </div>
  );
};

export default SupplyExpiringPage;
