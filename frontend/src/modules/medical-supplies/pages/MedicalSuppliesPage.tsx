/**
 * Medical Supplies Page
 *
 * The EMS side of the department's stock, on its own page so it can be run by
 * its own officer. Gear and uniforms live at /inventory and never appear here.
 *
 * The page opens on what expires rather than on a full item list: dated stock
 * is the thing that goes wrong quietly, and an officer checking in wants to
 * know what is about to lapse before they want an inventory count.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Tag,
  TrendingDown,
} from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { MedicalSupplySummary } from '../../../services/medicalSuppliesService';
import type { ExpiringLot, InventoryCategory, InventoryItem } from '../../../services/eventServices';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useRegisterPullToRefresh } from '../../../hooks/useRegisterPullToRefresh';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonCard } from '../../../components/ux/Skeleton';
import { MedicalItemFormModal } from '../components/MedicalItemFormModal';
import { ReceiveDeliveryModal } from '../components/ReceiveDeliveryModal';
import { EXPIRY_WINDOW_DAYS } from '../types';

type Tab = 'expiring' | 'stock';

/** Severity of a dated lot, by how long is left on it. */
function expiryTone(days: number | undefined): string {
  if (days === undefined || days === null) return 'text-theme-text-muted';
  if (days < 0) return 'text-red-700 dark:text-red-400';
  if (days <= 7) return 'text-orange-700 dark:text-orange-400';
  return 'text-amber-700 dark:text-amber-400';
}

function expiryLabel(days: number | undefined): string {
  if (days === undefined || days === null) return '—';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}

const StatTile: React.FC<StatTileProps> = ({ icon, label, value, tone }) => (
  <div className="card flex items-center gap-3 p-4">
    <div className={`rounded-md p-2 ${tone}`}>{icon}</div>
    <div className="min-w-0">
      <p className="text-theme-text-primary text-xl font-semibold tabular-nums">{formatNumber(value)}</p>
      <p className="text-theme-text-muted truncate text-xs">{label}</p>
    </div>
  </div>
);

const MedicalSuppliesPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  // Either grant works: a department running one supply line holds the broad
  // one, a department that split the job holds the medical one.
  const canManage = checkPermission('inventory.manage_medical') || checkPermission('inventory.manage');
  // The cross-reference below points into the gear catalogue, which is
  // manager-only — a medical-only supply officer would be sent to Access
  // Denied by a sentence that was only ever an aside.
  const canManageGear = checkPermission('inventory.manage');
  const tz = useTimezone();

  const [tab, setTab] = useState<Tab>('expiring');
  const [summary, setSummary] = useState<MedicalSupplySummary | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [expiring, setExpiring] = useState<ExpiringLot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [summaryData, itemsData, categoryData, expiringData] = await Promise.all([
        medicalSuppliesService.getSummary(EXPIRY_WINDOW_DAYS),
        medicalSuppliesService.getItems({
          search: search || undefined,
          category_id: categoryFilter || undefined,
          limit: 200,
        }),
        medicalSuppliesService.getCategories(),
        medicalSuppliesService.getExpiringLots(EXPIRY_WINDOW_DAYS),
      ]);
      setSummary(summaryData);
      setItems(itemsData.items);
      setCategories(categoryData);
      setExpiring(expiringData);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load medical supplies'));
    } finally {
      setIsLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useRegisterPullToRefresh(load);

  /** Lot stock is the real count for dated items; quantity is what's left over. */
  const onHand = (item: InventoryItem): number => (item.is_lot_stocked ? (item.lot_stock ?? 0) : (item.quantity ?? 0));

  /**
   * Resolve the category from the list this page already loaded.
   *
   * Not `item.category_name`: that field is not on `InventoryItemResponse`, so
   * FastAPI strips it on the way out and every categorized supply rendered a
   * dash. The categories are in hand anyway — one lookup beats widening a
   * response model shared with the gear endpoints.
   */
  const categoryName = (item: InventoryItem): string => categories.find((c) => c.id === item.category_id)?.name ?? '—';

  const lowStockItems = useMemo(
    () => items.filter((i) => i.reorder_point !== undefined && onHand(i) <= (i.reorder_point ?? 0)),
    [items]
  );

  const handleSaved = () => {
    setShowItemModal(false);
    setEditingItem(null);
    setShowDeliveryModal(false);
    void load();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <Link
          to="/dashboard"
          className="text-theme-text-muted hover:text-theme-text-primary mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-semibold">
              <Stethoscope className="h-6 w-6" />
              Medical Supplies
            </h1>
            <p className="text-theme-text-muted mt-1 text-sm">
              EMS stock with lot numbers and expiration dates. Gear and uniforms are tracked separately
              {canManageGear && (
                <>
                  {' '}
                  under{' '}
                  <Link to="/inventory" className="underline">
                    Gear &amp; Uniforms
                  </Link>
                </>
              )}
              .
            </p>
          </div>

          <div className="hscroll flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="btn-icon"
              aria-label="Refresh medical supplies"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {canManage && (
              <>
                <Link
                  to="/medical-supplies/categories"
                  className="btn-icon"
                  aria-label="Manage medical supply categories"
                >
                  <Tag className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => setShowDeliveryModal(true)}
                  className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                >
                  <PackagePlus className="h-4 w-4" />
                  Receive delivery
                </button>
                <button type="button" onClick={() => setShowItemModal(true)} className="btn-primary">
                  <Plus className="h-4 w-4" />
                  Add supply
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={<Stethoscope className="h-4 w-4 text-sky-700 dark:text-sky-400" />}
            label="Supply items"
            value={summary.total_items}
            tone="bg-sky-500/10"
          />
          <StatTile
            icon={<CalendarClock className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
            label={`Expiring within ${summary.expiring_within_days}d`}
            value={summary.expiring_soon}
            tone="bg-amber-500/10"
          />
          <StatTile
            icon={<AlertTriangle className="h-4 w-4 text-red-700 dark:text-red-400" />}
            label="Already expired"
            value={summary.expired}
            tone="bg-red-500/10"
          />
          <StatTile
            icon={<TrendingDown className="h-4 w-4 text-orange-700 dark:text-orange-400" />}
            label="Below reorder point"
            value={summary.low_stock}
            tone="bg-orange-500/10"
          />
        </div>
      )}

      <div className="tab-scroll mb-4">
        <button
          type="button"
          onClick={() => setTab('expiring')}
          aria-current={tab === 'expiring' ? 'page' : undefined}
          className={`mobile-touch-target px-4 py-2 text-sm font-medium ${
            tab === 'expiring'
              ? 'border-b-2 border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-400'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          Expiring stock
        </button>
        <button
          type="button"
          onClick={() => setTab('stock')}
          aria-current={tab === 'stock' ? 'page' : undefined}
          className={`mobile-touch-target px-4 py-2 text-sm font-medium ${
            tab === 'stock'
              ? 'border-b-2 border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-400'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          All supplies
        </button>
      </div>

      {isLoading ? (
        <SkeletonCard />
      ) : tab === 'expiring' ? (
        <section aria-label="Expiring stock">
          {expiring.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nothing expiring"
              description={`No medical stock lot expires within ${EXPIRY_WINDOW_DAYS} days.`}
            />
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">Item</th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">Lot</th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">
                      Expires
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-right text-xs font-semibold uppercase">
                      On hand
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.map((lot) => (
                    <tr key={lot.id} className="border-theme-surface-border border-b last:border-0">
                      <td data-label="Item" className="text-theme-text-primary px-4 py-3 font-medium">
                        {lot.item_name ?? '—'}
                      </td>
                      <td data-label="Lot" className="text-theme-text-muted px-4 py-3 font-mono text-xs">
                        {lot.lot_number || '—'}
                      </td>
                      <td data-label="Expires" className="text-theme-text-muted px-4 py-3">
                        {lot.expiration_date ? formatDate(lot.expiration_date, tz) : '—'}
                      </td>
                      <td data-label="On hand" className="text-theme-text-primary px-4 py-3 text-right tabular-nums">
                        {formatNumber(lot.quantity)}
                      </td>
                      <td
                        data-label="Status"
                        className={`px-4 py-3 font-medium ${expiryTone(lot.days_until_expiration)}`}
                      >
                        {expiryLabel(lot.days_until_expiration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section aria-label="All supplies">
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search supplies"
                aria-label="Search medical supplies"
                className="form-input w-full pl-9"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
              className="form-input w-auto"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {items.length === 0 ? (
            <EmptyState
              icon={Stethoscope}
              title="No medical supplies yet"
              description={
                canManage
                  ? 'Add a category first, then the supplies that go in it.'
                  : 'Nothing has been added to the medical catalog yet.'
              }
            />
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">Item</th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">
                      Category
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-right text-xs font-semibold uppercase">
                      On hand
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-right text-xs font-semibold uppercase">
                      Reorder at
                    </th>
                    <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-semibold uppercase">
                      Storage
                    </th>
                    {canManage && (
                      <th className="px-4 py-3 text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isLow = item.reorder_point !== undefined && onHand(item) <= (item.reorder_point ?? 0);
                    return (
                      <tr key={item.id} className="border-theme-surface-border border-b last:border-0">
                        <td data-label="Item" className="text-theme-text-primary px-4 py-3 font-medium">
                          {item.name}
                          {item.unit_of_measure && (
                            <span className="text-theme-text-muted ml-1 text-xs">({item.unit_of_measure})</span>
                          )}
                        </td>
                        <td data-label="Category" className="text-theme-text-muted px-4 py-3">
                          {categoryName(item)}
                        </td>
                        <td
                          data-label="On hand"
                          className={`px-4 py-3 text-right tabular-nums ${
                            isLow ? 'font-semibold text-orange-700 dark:text-orange-400' : 'text-theme-text-primary'
                          }`}
                        >
                          {formatNumber(onHand(item))}
                        </td>
                        <td data-label="Reorder at" className="text-theme-text-muted px-4 py-3 text-right tabular-nums">
                          {item.reorder_point === undefined ? '—' : formatNumber(item.reorder_point)}
                        </td>
                        <td data-label="Storage" className="text-theme-text-muted px-4 py-3">
                          {item.storage_location || '—'}
                        </td>
                        {canManage && (
                          <td data-label="Actions" className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setEditingItem(item)}
                              className="btn-icon"
                              aria-label={`Edit ${item.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {lowStockItems.length > 0 && (
            <p className="text-theme-text-muted mt-3 text-xs">
              {formatNumber(lowStockItems.length)} item(s) at or below their reorder point.
            </p>
          )}
        </section>
      )}

      {editingItem && (
        <MedicalItemFormModal
          categories={categories}
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={handleSaved}
        />
      )}

      {showItemModal && (
        <MedicalItemFormModal categories={categories} onClose={() => setShowItemModal(false)} onSaved={handleSaved} />
      )}

      {showDeliveryModal && (
        <ReceiveDeliveryModal items={items} onClose={() => setShowDeliveryModal(false)} onSaved={handleSaved} />
      )}
    </div>
  );
};

export default MedicalSuppliesPage;
