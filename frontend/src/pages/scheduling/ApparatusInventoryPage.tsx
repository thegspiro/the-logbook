/**
 * ApparatusInventoryPage
 *
 * The standing, any-hour view of what a truck is carrying — deliberately not a
 * check.
 *
 * An equipment check is a scheduled, signed pass over the whole apparatus that
 * produces a report. Until now it was also the only way anything about a
 * truck's stock could be written down, so a crew that used the last of
 * something at 03:00 had nowhere to put that fact and it waited to be
 * discovered by the next morning's check — which is precisely the window in
 * which a truck runs a call short.
 *
 * Here a member reports an item used the moment they use it, and swaps fresh
 * stock into the bracket if any is on the shelf. Both actions are crew work,
 * not officer work, so both sit behind the default member permission.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Loader2,
  PackageCheck,
  PackageX,
  Repeat,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import { apparatusService } from '../../modules/apparatus/services/api';
import type {
  ApparatusInventory,
  ApparatusInventoryItem,
  ItemDeployedLots,
  ReadyLot,
} from '../../modules/scheduling/types/equipmentCheck';
import type { ApparatusListItem } from '../../modules/apparatus/types';
import { PromptDialog } from '../../components/ux';
import LotsAboardPanel from '../../modules/scheduling/components/LotsAboardPanel';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDate, formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

const ApparatusInventoryPage: React.FC = () => {
  const tz = useTimezone();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('apparatus') ?? '';

  const [fleet, setFleet] = useState<ApparatusListItem[]>([]);
  const [inventory, setInventory] = useState<ApparatusInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [usedTarget, setUsedTarget] = useState<ApparatusInventoryItem | null>(null);
  const [swapTarget, setSwapTarget] = useState<ApparatusInventoryItem | null>(null);
  const [swapQuantity, setSwapQuantity] = useState(1);
  // The lots aboard for one position, opened from its "N lots" row.
  const [lotsTarget, setLotsTarget] = useState<ItemDeployedLots | null>(null);
  const [lotsBusy, setLotsBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apparatusService.getApparatusList({ pageSize: 200 });
        setFleet(res.items);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load apparatus'));
      }
    })();
  }, []);

  const load = useCallback(async (apparatusId: string) => {
    if (!apparatusId) {
      setInventory(null);
      return;
    }
    setLoading(true);
    try {
      setInventory(await schedulingService.getApparatusInventory(apparatusId));
    } catch (err: unknown) {
      setInventory(null);
      toast.error(getErrorMessage(err, 'Failed to load apparatus inventory'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedId);
  }, [selectedId, load]);

  const selectApparatus = (id: string) => {
    // Mirrored into the URL so a crew can bookmark their own rig.
    setSearchParams(id ? { apparatus: id } : {}, { replace: true });
  };

  const items = useMemo(() => inventory?.compartments.flatMap((c) => c.items) ?? [], [inventory]);
  const needingRestock = items.filter((i) => i.restockNeeded || i.isShort).length;
  const expiring = items.filter((i) => i.isExpired || (i.daysUntilExpiration ?? 999) <= 30).length;

  const reportUsed = async (item: ApparatusInventoryItem, note: string) => {
    setBusyItemId(item.templateItemId);
    try {
      await schedulingService.reportItemUsed(item.templateItemId, note);
      toast.success('Reported — the supply officer sees this now');
      await load(selectedId);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to report the item'));
    } finally {
      setBusyItemId(null);
    }
  };

  /**
   * One tap = one unit on or off the truck.
   *
   * Down is consumption and files a restock report with it, so the supply
   * officer sees the shortfall without the member opening anything. Up is a
   * hand restock, which the server settles the report against once the truck
   * is back to its target — a partial restock leaves it standing.
   */
  const adjustCount = async (item: ApparatusInventoryItem, delta: number) => {
    const current = item.quantityOnTruck ?? item.targetQuantity ?? 0;
    setBusyItemId(item.templateItemId);
    try {
      if (delta < 0) {
        await schedulingService.reportItemUsed(item.templateItemId, undefined, -delta);
      } else {
        await schedulingService.setItemQuantity(item.templateItemId, current + delta);
      }
      await load(selectedId);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update the count'));
    } finally {
      setBusyItemId(null);
    }
  };

  const openLots = async (item: ApparatusInventoryItem) => {
    setLotsBusy(true);
    try {
      setLotsTarget(await schedulingService.getItemDeployedLots(item.templateItemId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load the lots on this truck'));
    } finally {
      setLotsBusy(false);
    }
  };

  /**
   * Correct one lot — count, number and date together.
   *
   * The date matters as much as the count: a medication changed out has a new
   * expiration, and recording only the quantity leaves the application
   * asserting a date for a box that is no longer in the bag. Quantity zero
   * takes the lot off the truck, so a spent lot stops contributing its date to
   * the position's soonest-expiry reading.
   */
  const updateLot = async (
    lotId: string,
    changes: { quantity: number; lotNumber?: string; expirationDate?: string }
  ) => {
    if (!lotsTarget) return;
    setLotsBusy(true);
    try {
      const updated = await schedulingService.updateDeployedLot(lotsTarget.templateItemId, lotId, changes);
      setLotsTarget(updated);
      await load(selectedId);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update the lot'));
    } finally {
      setLotsBusy(false);
    }
  };

  const clearRestock = async (item: ApparatusInventoryItem) => {
    setBusyItemId(item.templateItemId);
    try {
      await schedulingService.clearItemRestock(item.templateItemId);
      toast.success('Restock report withdrawn');
      await load(selectedId);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to withdraw the report'));
    } finally {
      setBusyItemId(null);
    }
  };

  const swapLot = async (item: ApparatusInventoryItem, lot: ReadyLot, quantity: number) => {
    setBusyItemId(item.templateItemId);
    try {
      await schedulingService.swapItemLot(item.templateItemId, lot.id, quantity);
      toast.success('Fresh stock is on the truck');
      setSwapTarget(null);
      await load(selectedId);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to swap in stock'));
    } finally {
      setBusyItemId(null);
    }
  };

  const renderItem = (item: ApparatusInventoryItem) => {
    const busy = busyItemId === item.templateItemId;
    const expiringSoon = !item.isExpired && (item.daysUntilExpiration ?? 999) <= 30;

    return (
      <li key={item.templateItemId} className="border-theme-surface-border border-t px-3 py-3 first:border-t-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-theme-text-primary text-sm font-medium">{item.itemName}</span>
              {item.isExpired && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" /> EXPIRED
                </span>
              )}
              {expiringSoon && (
                <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  <Clock className="h-3 w-3" /> Expiring
                </span>
              )}
              {item.restockNeeded && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                  <PackageX className="h-3 w-3" /> Needs restock
                </span>
              )}
              {/* Shown without a report behind it too: a check that counted two
                  of four is the same shortfall as a crew reporting one. */}
              {item.isShort && !item.restockNeeded && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                  <PackageX className="h-3 w-3" /> Short
                </span>
              )}
            </div>
            <div className="text-theme-text-muted mt-0.5 flex flex-wrap gap-x-3 text-xs">
              {item.lotNumber && (
                <span>
                  Lot <span className="font-mono">{item.lotNumber}</span>
                </span>
              )}
              {item.expirationDate && <span>Exp {formatDate(item.expirationDate, tz)}</span>}
              {item.targetQuantity != null && (
                <span className={item.isShort ? 'font-medium text-orange-600 dark:text-orange-400' : ''}>
                  {item.quantityOnTruck ?? item.targetQuantity} of {item.targetQuantity}
                  {item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ''} aboard
                </span>
              )}
              {item.inventoryItemId && (
                <span className={item.readyStock > 0 ? 'text-green-700 dark:text-green-400' : ''}>
                  {item.readyStock} ready in stock
                </span>
              )}
            </div>
            {item.restockNeeded && (
              <p className="text-theme-text-muted mt-1 text-xs">
                Reported{item.restockReportedByName ? ` by ${item.restockReportedByName}` : ''}
                {item.restockReportedAt ? ` · ${formatDateTime(item.restockReportedAt, tz)}` : ''}
                {item.restockNote ? ` · "${item.restockNote}"` : ''}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {busy && <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />}
            {item.deployedLots.length > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void openLots(item)}
                className="text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target flex items-center gap-1 text-xs font-medium disabled:opacity-50"
              >
                {item.deployedLots.length} lot{item.deployedLots.length === 1 ? '' : 's'}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
            {item.targetQuantity != null && item.deployedLots.length === 0 && (
              <div className="border-theme-surface-border flex items-center gap-1 rounded-lg border px-1">
                <button
                  type="button"
                  disabled={busy || (item.quantityOnTruck ?? item.targetQuantity) <= 0}
                  onClick={() => void adjustCount(item, -1)}
                  className="btn-icon disabled:opacity-40"
                  aria-label={`Record one ${item.itemName} used`}
                >
                  &minus;
                </button>
                <span className="text-theme-text-primary w-6 text-center text-sm font-semibold tabular-nums">
                  {item.quantityOnTruck ?? item.targetQuantity}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void adjustCount(item, 1)}
                  className="btn-icon disabled:opacity-40"
                  aria-label={`Add one ${item.itemName} to the truck`}
                >
                  +
                </button>
              </div>
            )}
            {item.restockNeeded ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void clearRestock(item)}
                className="text-theme-text-muted hover:text-theme-text-secondary mobile-touch-target flex items-center gap-1 text-xs font-medium disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Undo
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setUsedTarget(item)}
                className="mobile-touch-target flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 disabled:opacity-50"
              >
                {/* On a counted position the minus button is what records use,
                    so this is the place to say *why* — damaged, contaminated,
                    missing — without pretending a unit was consumed. */}
                <PackageX className="h-3.5 w-3.5" aria-hidden="true" />
                {item.targetQuantity != null ? 'Flag' : 'Used'}
              </button>
            )}
            {item.inventoryItemId && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSwapTarget(item);
                  // Default to the shortfall: filling the gap is what the
                  // member came here to do, so it should need no arithmetic.
                  const short = (item.targetQuantity ?? 1) - (item.quantityOnTruck ?? item.targetQuantity ?? 0);
                  setSwapQuantity(Math.max(1, short));
                }}
                className="mobile-touch-target flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                <Repeat className="h-3.5 w-3.5" aria-hidden="true" /> Swap
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Truck className="h-6 w-6" aria-hidden="true" />
          Apparatus Inventory
        </h1>
        <p className="text-theme-text-muted mt-1 text-sm">
          Record what you used when you use it, and put fresh stock in the bracket. No check required.
        </p>
      </div>

      <div className="mb-4">
        <label htmlFor="apparatus-select" className="text-theme-text-secondary mb-1 block text-xs">
          Apparatus
        </label>
        <select
          id="apparatus-select"
          className="form-input sm:max-w-xs"
          value={selectedId}
          onChange={(e) => selectApparatus(e.target.value)}
        >
          <option value="">Select an apparatus…</option>
          {fleet.map((a) => (
            <option key={a.id} value={a.id}>
              {a.unitNumber}
              {a.name ? ` — ${a.name}` : ''}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        </div>
      )}

      {!loading && selectedId && inventory && items.length === 0 && (
        <p className="text-theme-text-muted card p-6 text-center text-sm">
          This apparatus has no checklist items to track. Add an equipment check template for it to start tracking what
          it carries.
        </p>
      )}

      {!loading && inventory && items.length > 0 && (
        <>
          <div className="text-theme-text-muted mb-3 flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <PackageCheck className="h-4 w-4" /> {items.length} tracked
            </span>
            {needingRestock > 0 && (
              <span className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
                <PackageX className="h-4 w-4" /> {needingRestock} need restock
              </span>
            )}
            {expiring > 0 && (
              <span className="flex items-center gap-1.5 text-yellow-700 dark:text-yellow-400">
                <Clock className="h-4 w-4" /> {expiring} expiring
              </span>
            )}
          </div>

          <div className="space-y-4">
            {inventory.compartments.map((compartment) => (
              <section key={compartment.compartmentId} className="card overflow-hidden p-0">
                <h2 className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary border-b px-3 py-2 text-sm font-semibold">
                  {compartment.compartmentName}
                </h2>
                <ul>{compartment.items.map(renderItem)}</ul>
              </section>
            ))}
          </div>
        </>
      )}

      <PromptDialog
        isOpen={usedTarget !== null}
        title={
          usedTarget?.targetQuantity != null
            ? `Flag ${usedTarget.itemName}`
            : `Report ${usedTarget?.itemName ?? 'item'} used`
        }
        message={
          usedTarget?.targetQuantity != null
            ? 'Puts this on the supply officer\u2019s worklist without changing the count \u2014 use the minus button for units actually used.'
            : "This puts the item on the supply officer's worklist right away. A note helps whoever restocks it."
        }
        label="Note (optional)"
        placeholder="e.g. used two on a call"
        confirmLabel={usedTarget?.targetQuantity != null ? 'Flag it' : 'Report used'}
        multiline
        required={false}
        onClose={() => setUsedTarget(null)}
        onSubmit={(note) => {
          const target = usedTarget;
          setUsedTarget(null);
          if (target) void reportUsed(target, note);
        }}
      />

      {lotsTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
          <div className="bg-theme-surface border-theme-surface-border flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl">
            <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-theme-text-primary truncate text-sm font-semibold">{lotsTarget.itemName}</h3>
                <p className="text-theme-text-muted truncate text-xs">
                  {lotsTarget.quantityOnTruck ?? 0}
                  {lotsTarget.targetQuantity != null ? `/${lotsTarget.targetQuantity}` : ''}
                  {lotsTarget.unitOfMeasure ? ` ${lotsTarget.unitOfMeasure}` : ''} aboard
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLotsTarget(null)}
                className="text-theme-text-muted hover:text-theme-text-primary p-1.5"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2 overflow-auto px-4 py-3">
              <LotsAboardPanel
                lots={lotsTarget.lots}
                busy={lotsBusy}
                heading="Soonest to expire first — the order to draw from, and the order a reported use comes off."
                onSave={(lotId, changes) => updateLot(lotId, changes)}
                onRemove={(lotId) => updateLot(lotId, { quantity: 0 })}
              />
            </div>
          </div>
        </div>
      )}

      {swapTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
          <div className="bg-theme-surface border-theme-surface-border flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl">
            <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-theme-text-primary truncate text-sm font-semibold">Replace from ready stock</h3>
                <p className="text-theme-text-muted truncate text-xs">{swapTarget.itemName}</p>
              </div>
              <button
                type="button"
                onClick={() => setSwapTarget(null)}
                className="text-theme-text-muted hover:text-theme-text-primary p-1.5"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2 overflow-auto px-4 py-3">
              {swapTarget.targetQuantity != null && swapTarget.readyLots.length > 0 && (
                <div className="flex items-center justify-between gap-3 pb-1">
                  <label htmlFor="swap-quantity" className="text-theme-text-secondary text-xs">
                    How many to put on the truck
                  </label>
                  <input
                    id="swap-quantity"
                    type="number"
                    min="1"
                    className="form-input w-20"
                    value={swapQuantity}
                    onChange={(e) => setSwapQuantity(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
              )}
              {swapTarget.readyLots.length === 0 ? (
                <p className="text-theme-text-muted py-8 text-center text-sm">
                  No in-date stock on hand. Report it used so the supply officer knows to order it.
                </p>
              ) : (
                swapTarget.readyLots.map((lot) => (
                  <div
                    key={lot.id}
                    className="border-theme-surface-border flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-theme-text-primary truncate text-sm font-medium">
                        {lot.lotNumber || 'No lot #'}
                      </p>
                      <p className="text-theme-text-muted text-xs">
                        {lot.expirationDate ? `Exp ${formatDate(lot.expirationDate, tz)}` : 'No expiration'} ·{' '}
                        {lot.quantity} ready
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyItemId === swapTarget.templateItemId || lot.quantity < swapQuantity}
                      onClick={() => void swapLot(swapTarget, lot, swapQuantity)}
                      className="btn-primary btn-sm inline-flex shrink-0 items-center gap-1 disabled:opacity-50"
                    >
                      <PackageCheck className="h-4 w-4" /> Swap in
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApparatusInventoryPage;
