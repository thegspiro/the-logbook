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
 * Here a member reports an item used the moment they use it — that is crew
 * work and sits behind the default member permission. Swapping stock onto the
 * truck and withdrawing a restock report rewrite the supply record, so the
 * server keeps them manage-gated and this page only offers them to callers
 * who hold that permission.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  PackageCheck,
  PackageX,
  Repeat,
  Boxes,
  Undo2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import { schedulingService } from '../../../modules/scheduling/services/api';
import { useAuthStore } from '../../../stores/authStore';
import type {
  ApparatusInventory,
  ApparatusInventoryItem,
  ItemDeployedLots,
  ReadyLot,
} from '../../../modules/inventory/types/equipmentCheck';
import { PromptDialog } from '../../../components/ux';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';
import LotsAboardPanel from '../../../modules/inventory/components/LotsAboardPanel';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCalendarDate, formatDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { useOverlaySurface } from '../../../hooks/useOverlaySurface';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';

/** One entry in the apparatus picker. */
interface FleetOption {
  id: string;
  unitNumber: string;
  name: string;
}

interface ApparatusInventoryPageProps {
  /**
   * Pins the page to one apparatus and drops its own picker — the Inventory
   * tab of the apparatus detail, which already names the rig in its header.
   */
  apparatusId?: string;
}

type InventoryFilter = 'all' | 'expired' | 'restock' | 'expiring';

const isExpiringSoon = (item: ApparatusInventoryItem) => !item.isExpired && (item.daysUntilExpiration ?? 999) <= 30;

/**
 * Which items each summary chip narrows the list to. The counts on the chips
 * come from the same predicates, so a chip never promises more rows than it
 * shows.
 */
const FILTER_PREDICATES: Record<InventoryFilter, (item: ApparatusInventoryItem) => boolean> = {
  all: () => true,
  expired: (item) => item.isExpired,
  restock: (item) => item.restockNeeded || item.isShort,
  expiring: isExpiringSoon,
};

const ApparatusInventoryPage: React.FC<ApparatusInventoryPageProps> = ({ apparatusId }) => {
  const tz = useTimezone();
  const { checkPermission } = useAuthStore();
  // Swapping stock and withdrawing a restock report are manage-gated on the
  // server (they rewrite the supply record); offering them to a submit-only
  // member would end every tap in a 403.
  const canManageStock = checkPermission('inventory.check_manage') || checkPermission('inventory.manage');
  const [searchParams, setSearchParams] = useSearchParams();
  const embedded = apparatusId !== undefined;
  const selectedId = apparatusId ?? searchParams.get('apparatus') ?? '';

  const [fleet, setFleet] = useState<FleetOption[]>([]);
  const [inventory, setInventory] = useState<ApparatusInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  // Whether the most recent change failed to reach the server, for the status
  // line: every tap saves on its own, so "saved" is only true while the last
  // one landed.
  const [lastChangeFailed, setLastChangeFailed] = useState(false);
  const [filter, setFilter] = useState<InventoryFilter>('all');
  const [usedTarget, setUsedTarget] = useState<ApparatusInventoryItem | null>(null);
  const [swapTarget, setSwapTarget] = useState<ApparatusInventoryItem | null>(null);

  const [swapQuantity, setSwapQuantity] = useState(1);
  // The lots aboard for one position, opened from its "N lots" row.
  const [lotsTarget, setLotsTarget] = useState<ItemDeployedLots | null>(null);
  // Takes the fixed mobile bottom bar off this overlay while it is open.
  useOverlaySurface(Boolean(lotsTarget) || Boolean(swapTarget));
  const [lotsBusy, setLotsBusy] = useState(false);

  useEffect(() => {
    // The fleet list exists only to fill the picker. Embedded there is no
    // picker, so skip it.
    if (embedded) return;
    void (async () => {
      try {
        // `/scheduling/apparatus-options` rather than the apparatus module's
        // own roster: this page is crew-level by both its route gate and its
        // backend gate, and regular members do not hold `apparatus.view`, so
        // reading `GET /apparatus` here 403'd them into an empty picker. This
        // endpoint is gated on authentication alone and already backs the
        // shift board's picker.
        //
        // Narrowed to `source === 'apparatus'` because the endpoint falls back
        // to BasicApparatus records and then to hardcoded defaults, neither of
        // which `/equipment-checks/apparatus/{id}/inventory` knows anything
        // about — that filtered set is also exactly what `GET /apparatus`
        // returned before.
        const { options } = await schedulingService.getApparatusOptions();
        setFleet(
          options.flatMap((option) =>
            option.source === 'apparatus' && option.id
              ? [{ id: option.id, unitNumber: option.unit_number || option.name, name: option.name }]
              : []
          )
        );
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load apparatus'));
      }
    })();
  }, [embedded]);

  // Named `targetId` rather than `apparatusId` so it cannot be confused with
  // the prop of that name now that this page can be pinned to one rig.
  const load = useCallback(async (targetId: string) => {
    if (!targetId) {
      setInventory(null);
      return;
    }
    setLoading(true);
    try {
      setInventory(await equipmentCheckService.getApparatusInventory(targetId));
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
    setFilter('all');
    setLastChangeFailed(false);
    // Mirrored into the URL so a crew can bookmark their own rig.
    setSearchParams(id ? { apparatus: id } : {}, { replace: true });
  };

  const items = useMemo(() => inventory?.compartments.flatMap((c) => c.items) ?? [], [inventory]);
  const needingRestock = items.filter(FILTER_PREDICATES.restock).length;
  // Expired and expiring are counted apart. Lumping them reads as "two items
  // want attention some time soon" when one of them is unusable right now.
  const expired = items.filter(FILTER_PREDICATES.expired).length;
  const expiring = items.filter(FILTER_PREDICATES.expiring).length;
  // A filter whose chip has gone (the last expired item was swapped out) falls
  // back to everything rather than leaving an empty list with no way back.
  const activeFilter: InventoryFilter = filter === 'all' || items.some(FILTER_PREDICATES[filter]) ? filter : 'all';
  const visibleCompartments = (inventory?.compartments ?? [])
    .map((compartment) => ({
      ...compartment,
      items: compartment.items.filter(FILTER_PREDICATES[activeFilter]),
    }))
    .filter((compartment) => compartment.items.length > 0);

  const reportUsed = async (item: ApparatusInventoryItem, note: string) => {
    setBusyItemId(item.templateItemId);
    try {
      await equipmentCheckService.reportItemUsed(item.templateItemId, note);
      toast.success('Reported — the supply officer sees this now');
      setLastChangeFailed(false);
      await load(selectedId);
    } catch (err: unknown) {
      setLastChangeFailed(true);
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
        await equipmentCheckService.reportItemUsed(item.templateItemId, undefined, -delta);
      } else {
        await equipmentCheckService.setItemQuantity(item.templateItemId, current + delta);
      }
      setLastChangeFailed(false);
      await load(selectedId);
    } catch (err: unknown) {
      setLastChangeFailed(true);
      toast.error(getErrorMessage(err, 'Failed to update the count'));
    } finally {
      setBusyItemId(null);
    }
  };

  const openLots = async (item: ApparatusInventoryItem) => {
    setLotsBusy(true);
    try {
      setLotsTarget(await equipmentCheckService.getItemDeployedLots(item.templateItemId));
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
      const updated = await equipmentCheckService.updateDeployedLot(lotsTarget.templateItemId, lotId, changes);
      setLotsTarget(updated);
      setLastChangeFailed(false);
      await load(selectedId);
    } catch (err: unknown) {
      setLastChangeFailed(true);
      toast.error(getErrorMessage(err, 'Failed to update the lot'));
    } finally {
      setLotsBusy(false);
    }
  };

  const clearRestock = async (item: ApparatusInventoryItem) => {
    setBusyItemId(item.templateItemId);
    try {
      await equipmentCheckService.clearItemRestock(item.templateItemId);
      toast.success('Restock report withdrawn');
      setLastChangeFailed(false);
      await load(selectedId);
    } catch (err: unknown) {
      setLastChangeFailed(true);
      toast.error(getErrorMessage(err, 'Failed to withdraw the report'));
    } finally {
      setBusyItemId(null);
    }
  };

  const swapLot = async (item: ApparatusInventoryItem, lot: ReadyLot, quantity: number) => {
    setBusyItemId(item.templateItemId);
    try {
      await equipmentCheckService.swapItemLot(item.templateItemId, lot.id, quantity);
      toast.success('Fresh stock is on the truck');
      setSwapTarget(null);
      setLastChangeFailed(false);
      await load(selectedId);
    } catch (err: unknown) {
      setLastChangeFailed(true);
      toast.error(getErrorMessage(err, 'Failed to swap in stock'));
    } finally {
      setBusyItemId(null);
    }
  };

  const renderItem = (item: ApparatusInventoryItem) => {
    const busy = busyItemId === item.templateItemId;
    const expiringSoon = isExpiringSoon(item);

    return (
      <li key={item.templateItemId} className="border-theme-surface-border border-t px-3 py-3 first:border-t-0">
        {/* Stacked on a phone: side by side, the controls took a fixed width
            and squeezed the name and its details into a column one word wide. */}
        <div className="split-row gap-2 sm:items-start">
          <div className="split-row-main">
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
              {item.expirationDate && (
                <span>
                  Exp {formatCalendarDate(item.expirationDate, { year: 'numeric', month: 'numeric', day: 'numeric' })}
                </span>
              )}
              {item.targetQuantity != null && (
                <span className={item.isShort ? 'font-medium text-orange-700 dark:text-orange-400' : ''}>
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
          </div>

          <div className="split-row-aside flex flex-wrap items-center gap-x-3 gap-y-1">
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
              // Withdrawing a report (DELETE .../used) is manage-gated on the
              // server: it erases a shortfall claim without restocking. A
              // member who reported in error asks the supply officer; the
              // "Reported by" line below already says who filed it.
              canManageStock ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearRestock(item)}
                  className="text-theme-text-muted hover:text-theme-text-secondary mobile-touch-target flex items-center gap-1 text-xs font-medium disabled:opacity-50"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Undo
                </button>
              ) : null
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setUsedTarget(item)}
                className="mobile-touch-target flex items-center gap-1 text-xs font-medium text-orange-700 hover:text-orange-700 disabled:opacity-50 dark:text-orange-600"
              >
                {/* On a counted position the minus button is what records use,
                    so this is the place to say *why* — damaged, contaminated,
                    missing — without pretending a unit was consumed. */}
                <PackageX className="h-3.5 w-3.5" aria-hidden="true" />
                {item.targetQuantity != null ? 'Flag' : 'Used'}
              </button>
            )}
            {/* Disabled (not hidden) without a manage permission: the swap
                endpoint is manage-gated, and the tooltip says who records it
                instead of letting the tap end in a 403. */}
            {item.inventoryItemId && (
              <button
                type="button"
                disabled={busy || !canManageStock}
                onClick={() => {
                  setSwapTarget(item);
                  // Default to the shortfall: filling the gap is what the
                  // member came here to do, so it should need no arithmetic.
                  const short = (item.targetQuantity ?? 1) - (item.quantityOnTruck ?? item.targetQuantity ?? 0);
                  setSwapQuantity(Math.max(1, short));
                }}
                title={canManageStock ? undefined : 'Swaps from stock are recorded by an officer or the quartermaster'}
                className="mobile-touch-target flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Repeat className="h-3.5 w-3.5" aria-hidden="true" /> Swap
              </button>
            )}
          </div>
        </div>
        {item.restockNeeded && (
          <p className="text-theme-text-muted mt-1 text-xs">
            Reported{item.restockReportedByName ? ` by ${item.restockReportedByName}` : ''}
            {item.restockReportedAt ? ` · ${formatDateTime(item.restockReportedAt, tz)}` : ''}
            {item.restockNote ? ` · "${item.restockNote}"` : ''}
          </p>
        )}
      </li>
    );
  };

  // Every tap saves on its own, so there is nothing for a Save button to do;
  // this says whether the last one landed instead of asking the crew to press
  // something that only re-read the list.
  const saving = busyItemId !== null || lotsBusy;
  const saveStatus = inventory ? (
    <p
      role="status"
      aria-live="polite"
      className={`flex items-center gap-1.5 text-xs ${
        saving
          ? 'text-theme-text-muted'
          : lastChangeFailed
            ? 'text-red-700 dark:text-red-400'
            : 'text-green-700 dark:text-green-400'
      }`}
    >
      {saving ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…
        </>
      ) : lastChangeFailed ? (
        <>
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Last change didn&apos;t save
        </>
      ) : (
        <>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> All changes saved
        </>
      )}
    </p>
  ) : null;

  return (
    <div className={embedded ? '' : 'mx-auto max-w-7xl px-4 py-6'}>
      {embedded ? (
        <div className="mb-3 space-y-1">
          <p className="text-theme-text-muted text-sm">
            Record what you used when you use it, and put fresh stock in the bracket. No check required.
          </p>
          {saveStatus}
        </div>
      ) : (
        <>
          <OperationsPageHeader
            icon={Boxes}
            title="Apparatus Inventory"
            subtitle="Record what you used when you use it, and put fresh stock in the bracket. No check required."
          />

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
                  {a.name && a.name !== a.unitNumber ? ` — ${a.name}` : ''}
                </option>
              ))}
            </select>
            <div className="mt-1.5">{saveStatus}</div>
          </div>
        </>
      )}

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
          {/* Chips filter the list: on a phone the expired item is otherwise
              somewhere down a long scroll, with nothing pointing at it. */}
          <ScrollCueRow className="mb-3 flex gap-2" data-mobile-scroll-region role="group" aria-label="Filter items">
            {(
              [
                { key: 'all', count: items.length, label: 'tracked', Icon: PackageCheck, tone: '' },
                {
                  key: 'expired',
                  count: expired,
                  label: 'expired',
                  Icon: AlertTriangle,
                  tone: 'text-red-700 dark:text-red-400',
                },
                {
                  key: 'restock',
                  count: needingRestock,
                  label: 'need restock',
                  Icon: PackageX,
                  tone: 'text-orange-700 dark:text-orange-400',
                },
                {
                  key: 'expiring',
                  count: expiring,
                  label: 'expiring',
                  Icon: Clock,
                  tone: 'text-yellow-700 dark:text-yellow-400',
                },
              ] as const
            )
              .filter((chip) => chip.key === 'all' || chip.count > 0)
              .map(({ key, count, label, Icon, tone }) => {
                const active = activeFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(active || key === 'all' ? 'all' : key)}
                    className={`touch-target-phone flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors ${
                      active
                        ? 'border-theme-text-primary bg-theme-surface-secondary text-theme-text-primary'
                        : `border-theme-surface-border ${tone || 'text-theme-text-muted'} hover:bg-theme-surface-hover`
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" /> {count} {label}
                  </button>
                );
              })}
          </ScrollCueRow>

          <div className="space-y-4">
            {visibleCompartments.map((compartment) => (
              // No overflow-hidden: it would make the card the heading's
              // scroll container, and the heading could then never stick.
              <section key={compartment.compartmentId} className="card p-0">
                {/* Pinned below the fixed mobile header (top-0 from 768px) on
                    an opaque layer, so the items do not show through it. */}
                <div className="bg-theme-bg mobile-header-inset sticky z-10 rounded-t-xl md:top-0">
                  <h2 className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-primary rounded-t-xl border-b px-3 py-2 text-sm font-semibold">
                    {compartment.compartmentName}
                  </h2>
                </div>
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
        label="Note"
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
        <div className="modal-overlay z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="bg-theme-surface-modal border-theme-surface-border flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl">
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
            <div className="pb-safe space-y-2 overflow-auto px-4 py-3 sm:pb-3">
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
        <div className="modal-overlay z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="bg-theme-surface-modal border-theme-surface-border flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl">
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
            <div className="pb-safe space-y-2 overflow-auto px-4 py-3 sm:pb-3">
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
                        {lot.expirationDate
                          ? `Exp ${formatCalendarDate(lot.expirationDate, { year: 'numeric', month: 'numeric', day: 'numeric' })}`
                          : 'No expiration'}{' '}
                        · {lot.quantity} ready
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
