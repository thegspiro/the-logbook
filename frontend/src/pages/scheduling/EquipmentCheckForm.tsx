/**
 * Equipment Check Form — Phone-First Hybrid Layout
 *
 * Flow:
 * 1. Compartment overview grid (color-coded cards showing status)
 * 2. Tap a compartment to drill into its item list
 * 3. Check each item using the appropriate input for its check type
 * 4. Navigate between compartments with prev/next
 * 5. Return to overview and submit when all items are checked
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  CheckCircle,
  CheckCircle2,
  XCircle,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Clock,
  MessageSquare,
  Loader2,
  ArrowLeft,
  Hash,
  Gauge,
  Calendar,
  Eye,
  Wrench,
  Camera,
  Info,
  Minus,
  MinusCircle,
  Plus,
  Type,
  WifiOff,
  RefreshCw,
  Repeat,
  X,
  PackageCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import { inventoryService } from '../../services/inventoryService';
import type { InventoryLot } from '../../services/eventServices';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatCalendarDate, getTodayLocalDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  enqueueCheck,
  listPendingChecks,
  dequeueCheck,
  markRetry,
  pendingCount as getPendingCount,
  type SyncStatus,
} from '../../utils/offlineQueue';
import type {
  EquipmentCheckTemplate,
  CheckTemplateCompartment,
  CheckTemplateItem,
  CheckItemResultSubmit,
  ShiftEquipmentCheckCreate,
  StandaloneEquipmentCheckCreate,
  CheckType,
  CheckItemStatus,
  LastCheckItemResult,
  DeployedLot,
} from '../../modules/scheduling/types/equipmentCheck';
import { CHECK_TYPE_LABELS } from '../../modules/scheduling/types/equipmentCheck';
import { flattenCompartmentTree } from '../../modules/scheduling/utils/compartmentTree';
import LotsAboardPanel from '../../modules/scheduling/components/LotsAboardPanel';

import { useConfirm } from '../../contexts/ConfirmContext';
// ============================================================================
// Types
// ============================================================================

interface EquipmentCheckFormProps {
  shiftId?: string | undefined;
  template: EquipmentCheckTemplate;
  onComplete?: () => void;
  onBack?: () => void;
  previewMode?: boolean;
  existingCheckId?: string | undefined;
  /**
   * Which shift this check belongs to. Once the checklist was open the only
   * heading was the template name, so two trucks running the same template
   * produced identical screens and a member could fill in the wrong one with
   * nothing on the page to catch it.
   */
  shiftContext?:
    | {
        apparatusName?: string | undefined;
        shiftDate?: string | undefined;
        checkTiming?: string | undefined;
      }
    | undefined;
}

interface ItemResult {
  status: CheckItemStatus;
  quantityFound?: number | undefined;
  levelReading?: number | undefined;
  serialNumber?: string | undefined;
  lotNumber?: string | undefined;
  serialFound?: string | undefined;
  lotFound?: string | undefined;
  expirationFound?: string | undefined;
  photoUrls?: string[] | undefined;
  photoFiles?: File[] | undefined;
  notes?: string | undefined;
}

/** How many short items the par warning names before it starts summarizing. */
const SHORTFALL_PREVIEW_LIMIT = 6;

/**
 * What "Set All to Par" would overwrite, itemized.
 *
 * A compartment can easily have a dozen items below par, and the answer to
 * "are these really full?" depends on which ones and by how much. Joined into
 * a sentence those names become an unreadable run with no numbers in it — the
 * crew would be agreeing to something they cannot read. A list gives each
 * item its own line and shows the size of the claim being made on its behalf,
 * capped so the dialog cannot grow past a glance.
 */
const ShortfallList: React.FC<{
  items: CheckTemplateItem[];
  results: Record<string, ItemResult>;
}> = ({ items, results }) => {
  const shown = items.slice(0, SHORTFALL_PREVIEW_LIMIT);
  const remaining = items.length - shown.length;

  return (
    <div className="space-y-3 text-left">
      <p>
        {items.length === 1 ? 'This item is' : `These ${items.length} items are`} below the required quantity. Recording{' '}
        {items.length === 1 ? 'it' : 'them'} at par says the missing stock is now on the truck.
      </p>
      <ul className="border-theme-surface-border divide-theme-surface-border divide-y rounded-md border">
        {shown.map((item) => {
          const required = item.requiredQuantity ?? item.expectedQuantity;
          const found = results[item.id]?.quantityFound;
          return (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="text-theme-text-primary min-w-0 truncate">{item.name}</span>
              <span className="text-theme-text-muted shrink-0 font-mono text-xs">
                {found ?? 0} → {required ?? 0}
              </span>
            </li>
          );
        })}
      </ul>
      {remaining > 0 && (
        <p className="text-theme-text-muted text-xs">
          and {remaining} more item{remaining === 1 ? '' : 's'} below par
        </p>
      )}
      {/* Same weight as the lead, not muted fine print: this is the condition
          the whole decision turns on, and rendering it as the faintest thing
          on screen inverts what the crew should read first. */}
      <p className="text-theme-text-primary font-medium">Only do this if you have actually restocked.</p>
    </div>
  );
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Expiry verdict for a checklist item, as YYYY-MM-DD calendar-day comparison.
 *
 * `today` is the local (org-timezone) date so the answer matches the backend's
 * `expiration_date < today`, which is what actually force-fails the item on
 * submit. Parsing the date-only string into a `Date` instead would put it at
 * UTC midnight and call an item expired on its own expiry day in any timezone
 * behind UTC — the badge would say EXPIRED while the server passed it.
 */
/**
 * The soonest date actually aboard, falling back to the position's own column.
 *
 * A position holding three boxes holds three dates, and the truck is exposed
 * by its oldest. Reading the column instead would report the date of whichever
 * lot was restocked last.
 */
function soonestExpiration(item: CheckTemplateItem): string | undefined {
  const dated = (item.lotsAboard ?? []).filter((lot) => lot.expirationDate);
  if (dated.length > 0) {
    // The API sorts them, but a verdict that takes an apparatus out of service
    // should not depend on the order a payload arrived in.
    return dated.reduce((soonest, lot) => ((lot.expirationDate ?? '') < (soonest.expirationDate ?? '') ? lot : soonest))
      .expirationDate;
  }
  return item.hasExpiration ? item.expirationDate : undefined;
}

function getExpirationStatus(item: CheckTemplateItem, today: string): 'ok' | 'expiring_soon' | 'expired' | null {
  const soonest = soonestExpiration(item);
  if (!soonest) return null;

  const expDate = soonest.slice(0, 10);
  if (expDate < today) return 'expired';

  const warningMs = (item.expirationWarningDays ?? 30) * 24 * 60 * 60 * 1000;
  const daysOut = Date.parse(`${expDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  if (daysOut < warningMs) return 'expiring_soon';

  return 'ok';
}

function getCompartmentStatus(
  compartment: CheckTemplateCompartment,
  results: Record<string, ItemResult>
): 'complete' | 'has_failures' | 'in_progress' | 'not_started' {
  const checkable = compartment.items.filter((i) => i.checkType !== 'header' && i.checkType !== 'text');
  if (checkable.length === 0) return 'complete';

  let checked = 0;
  let failed = 0;
  for (const item of checkable) {
    const result = results[item.id];
    if (result && result.status !== 'not_checked') {
      checked++;
      if (result.status === 'fail') failed++;
    }
  }

  if (checked === 0) return 'not_started';
  if (checked === checkable.length) {
    return failed > 0 ? 'has_failures' : 'complete';
  }
  return 'in_progress';
}

const STATUS_COLORS = {
  complete: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
  has_failures: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
  in_progress: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  not_started: 'border-theme-surface-border bg-theme-surface text-theme-text-muted',
} as const;

const STATUS_LABELS: Record<string, string> = {
  complete: 'Complete',
  has_failures: 'Has Failures',
  in_progress: 'In Progress',
  not_started: 'Not Started',
};

const CHECK_TYPE_ICONS: Partial<Record<CheckType, React.ElementType>> = {
  pass_fail: CheckCircle,
  present: Eye,
  functional: Wrench,
  quantity: Hash,
  level: Gauge,
  date_lot: Calendar,
  reading: Hash,
  text: MessageSquare,
  header: Type,
};

// ============================================================================
// Component
// ============================================================================

const EquipmentCheckForm: React.FC<EquipmentCheckFormProps> = ({
  shiftId,
  template,
  onComplete,
  onBack,
  previewMode,
  existingCheckId,
  shiftContext,
}) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  // Calendar day in the org's timezone — the reference every expiry check in
  // this form compares against, so the badge, the auto-fail and the server all
  // agree on what "expired" means.
  const today = useMemo(() => getTodayLocalDate(tz), [tz]);
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  // Lot swaps performed during this check: override the deployed item's lot /
  // expiration so the badge reflects the fresher unit that was swapped in.
  const [swapOverrides, setSwapOverrides] = useState<Record<string, { lotNumber?: string; expirationDate?: string }>>(
    {}
  );
  const [swapTarget, setSwapTarget] = useState<CheckTemplateItem | null>(null);
  // Lots corrected during this check, so the row reflects the box the crew is
  // holding without waiting for a template re-fetch.
  const [lotEdits, setLotEdits] = useState<Record<string, DeployedLot[]>>({});
  const [lotBusyId, setLotBusyId] = useState<string | null>(null);
  const [swapLots, setSwapLots] = useState<InventoryLot[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [collapsedCompartments, setCollapsedCompartments] = useState<Set<string>>(new Set());
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [expandedSerialUpdate, setExpandedSerialUpdate] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [overallNotes, setOverallNotes] = useState('');
  const [lastCheckData, setLastCheckData] = useState<Record<string, LastCheckItemResult> | null>(null);
  const photoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const isOnline = useOnlineStatus();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const syncingRef = useRef(false);

  // --------------------------------------------------------------------------
  // Resolve sub-compartments: merge children inline under their parent
  // --------------------------------------------------------------------------

  // Flatten the compartment tree to any depth. Each top-level compartment
  // becomes one card; every nested container (a "pack" inside a "bag" inside a
  // "compartment") is merged in below its parent as a synthetic sub-heading
  // that shows its type + name, indented by depth. `storagePathByItemId`
  // records each item's full location path so submitted results and reports
  // reflect exactly where the item lives, not just its top-level compartment.
  const { compartments, storagePathByItemId } = useMemo(
    () => flattenCompartmentTree(template.compartments),
    [template.compartments]
  );

  // --------------------------------------------------------------------------
  // Offline queue sync — drain pending checks when connectivity returns
  // --------------------------------------------------------------------------

  const syncPendingChecks = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncStatus('syncing');

    try {
      const pending = await listPendingChecks();
      let failed = 0;

      for (const entry of pending) {
        try {
          const record = await schedulingService.submitEquipmentCheck(entry.shiftId, entry.payload);

          // Upload queued photos
          const photosByItem = new Map<string, Array<{ blob: Blob; fileName: string }>>();
          for (const photo of entry.photos) {
            const arr = photosByItem.get(photo.itemId) ?? [];
            arr.push({ blob: photo.blob, fileName: photo.fileName });
            photosByItem.set(photo.itemId, arr);
          }
          for (const [itemId, photos] of photosByItem) {
            const files = photos.map((p) => new File([p.blob], p.fileName, { type: p.blob.type }));
            try {
              await schedulingService.uploadCheckItemPhotos(record.id, itemId, files);
            } catch {
              // Photo upload failure is non-fatal
            }
          }

          await dequeueCheck(entry.id);
        } catch {
          failed++;
          await markRetry(entry.id);
        }
      }

      const remaining = await getPendingCount();
      setPendingQueueCount(remaining);
      setSyncStatus(failed > 0 ? 'error' : 'idle');

      if (pending.length > 0 && failed === 0) {
        toast.success(`Synced ${pending.length} queued check(s)`);
      } else if (failed > 0) {
        toast.error(`${failed} check(s) failed to sync — will retry`);
      }
    } catch {
      setSyncStatus('error');
    } finally {
      syncingRef.current = false;
    }
  }, []);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline && !previewMode) {
      void syncPendingChecks();
    }
  }, [isOnline, previewMode, syncPendingChecks]);

  // Load pending count on mount
  useEffect(() => {
    if (previewMode) return;
    void getPendingCount()
      .then(setPendingQueueCount)
      .catch(() => {});
  }, [previewMode]);

  // --------------------------------------------------------------------------
  // Progress
  // --------------------------------------------------------------------------

  const allItems = useMemo(() => compartments.flatMap((c) => c.items), [compartments]);

  const checkableItems = useMemo(
    () => allItems.filter((item) => item.checkType !== 'header' && item.checkType !== 'text'),
    [allItems]
  );

  const totalItems = checkableItems.length;
  const checkedItems = checkableItems.filter((item) => {
    const result = results[item.id];
    return result && result.status !== 'not_checked';
  }).length;
  const progressPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  /**
   * "Brush 5 · Sat, Aug 16" beside a timing badge — whichever of the three we
   * know. The timing is a badge rather than more grey text because the
   * end-of-shift checklist was otherwise indistinguishable from the
   * start-of-shift one: same layout, same buttons, same Submit, only the
   * template name differing. The colours match the cards these are opened from.
   */
  const shiftContextLine = [
    shiftContext?.apparatusName,
    shiftContext?.shiftDate
      ? formatCalendarDate(shiftContext.shiftDate, { weekday: 'short', month: 'short', day: 'numeric' })
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const timingLabel =
    shiftContext?.checkTiming === 'start_of_shift'
      ? 'Start of shift'
      : shiftContext?.checkTiming === 'end_of_shift'
        ? 'End of shift'
        : null;

  const unansweredRequiredCount = checkableItems.filter((item) => {
    if (!item.isRequired) return false;
    const result = results[item.id];
    return !result || result.status === 'not_checked';
  }).length;
  const allRequiredChecked = unansweredRequiredCount === 0;

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const updateResult = useCallback((itemId: string, patch: Partial<ItemResult>) => {
    setResults((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        status: prev[itemId]?.status ?? 'not_checked',
        ...patch,
      },
    }));
  }, []);

  // Apply an in-check replacement to an item so the badge, the auto-fail and
  // the submitted snapshot all reflect the unit now on the truck rather than
  // the one it replaced. Two sources, in order: a lot swapped from inventory
  // (which the server already wrote to the template), then an expiration the
  // crew typed in by hand — the crew reading the box wins over both.
  const applyOverride = useCallback(
    (item: CheckTemplateItem): CheckTemplateItem => {
      const o = swapOverrides[item.id];
      const typedExpiration = results[item.id]?.expirationFound;
      const corrected = lotEdits[item.id];
      if (!o && !typedExpiration && !corrected) return item;
      return {
        ...item,
        ...(corrected ? { lotsAboard: corrected } : {}),
        ...(o?.lotNumber !== undefined ? { lotNumber: o.lotNumber } : {}),
        ...(o?.expirationDate !== undefined ? { hasExpiration: true, expirationDate: o.expirationDate } : {}),
        ...(typedExpiration ? { hasExpiration: true, expirationDate: typedExpiration } : {}),
      };
    },
    [swapOverrides, results, lotEdits]
  );

  const openSwap = useCallback(
    async (item: CheckTemplateItem) => {
      if (!item.inventoryItemId) return;
      setSwapTarget(item);
      setSwapLots([]);
      setSwapLoading(true);
      try {
        const lots = await inventoryService.getItemLots(item.inventoryItemId);
        // Freshest (latest expiration) first — that's the best unit to swap in.
        // Stock that expired on the shelf is left out: the server refuses it, and
        // offering it would only invite a swap that fails the item straight back.
        const inStock = lots
          .filter((l) => l.quantity > 0 && !(l.expiration_date && l.expiration_date < today))
          .sort((a, b) => (b.expiration_date ?? '').localeCompare(a.expiration_date ?? ''));
        setSwapLots(inStock);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load ready stock'));
      } finally {
        setSwapLoading(false);
      }
    },
    [today]
  );

  /**
   * Correct one lot aboard from inside the check.
   *
   * This is the reconciliation a check is for: a crew reading a date off a box
   * that disagrees with the record fixes the record then and there, rather
   * than passing an item whose stored expiration belongs to a unit no longer
   * in the bag.
   */
  const correctLot = async (
    item: CheckTemplateItem,
    lotId: string,
    changes: { quantity: number; lotNumber?: string; expirationDate?: string }
  ) => {
    setLotBusyId(item.id);
    try {
      const updated = await schedulingService.updateDeployedLot(item.id, lotId, changes);
      setLotEdits((prev) => ({ ...prev, [item.id]: updated.lots }));
      toast.success('Lot updated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update the lot'));
    } finally {
      setLotBusyId(null);
    }
  };

  const doSwap = useCallback(
    async (lot: InventoryLot) => {
      if (!swapTarget) return;
      setSwapping(true);
      try {
        const res = await schedulingService.swapItemLot(swapTarget.id, lot.id);
        setSwapOverrides((prev) => ({
          ...prev,
          [swapTarget.id]: {
            ...(res.lotNumber !== undefined ? { lotNumber: res.lotNumber } : {}),
            ...(res.expirationDate !== undefined ? { expirationDate: res.expirationDate } : {}),
          },
        }));
        // Record the swapped-in lot as the found lot/expiration and clear the
        // auto-fail — the item on the truck is no longer the expired one.
        updateResult(swapTarget.id, {
          lotFound: res.lotNumber,
          expirationFound: res.expirationDate,
          status: 'not_checked',
        });
        toast.success('Swapped in fresh stock');
        setSwapTarget(null);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to swap lot'));
      } finally {
        setSwapping(false);
      }
    },
    [swapTarget, updateResult]
  );

  const toggleNotes = useCallback((itemId: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const toggleSerialUpdate = useCallback((itemId: string) => {
    setExpandedSerialUpdate((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const toggleCompartmentCollapse = useCallback((compId: string) => {
    setCollapsedCompartments((prev) => {
      const next = new Set(prev);
      if (next.has(compId)) next.delete(compId);
      else next.add(compId);
      return next;
    });
  }, []);

  const handlePhotoSelect = useCallback(
    (itemId: string, fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const newFiles = Array.from(fileList).slice(0, 3);
      const currentFiles = results[itemId]?.photoFiles ?? [];
      const combined = [...currentFiles, ...newFiles].slice(0, 3);

      // Revoke old blob URLs to prevent memory leaks
      const oldUrls = results[itemId]?.photoUrls ?? [];
      for (const url of oldUrls) {
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
      }

      // Create preview URLs for display
      const previewUrls = combined.map((f) => URL.createObjectURL(f));

      updateResult(itemId, {
        photoFiles: combined,
        photoUrls: previewUrls,
      });
    },
    [results, updateResult]
  );

  const removePhoto = useCallback(
    (itemId: string, index: number) => {
      const currentFiles = results[itemId]?.photoFiles ?? [];
      const currentUrls = results[itemId]?.photoUrls ?? [];

      // Revoke the object URL to prevent memory leaks
      const urlToRevoke = currentUrls[index];
      if (urlToRevoke?.startsWith('blob:')) {
        URL.revokeObjectURL(urlToRevoke);
      }

      const newFiles = currentFiles.filter((_, i) => i !== index);
      const newUrls = currentUrls.filter((_, i) => i !== index);

      updateResult(itemId, {
        photoFiles: newFiles.length > 0 ? newFiles : undefined,
        photoUrls: newUrls.length > 0 ? newUrls : undefined,
      });
    },
    [results, updateResult]
  );

  // --------------------------------------------------------------------------
  // Draft persistence — save progress to localStorage so it survives crashes
  // --------------------------------------------------------------------------

  const draftKey = `equipment-check-draft-${shiftId || 'standalone'}-${template.id}`;

  useEffect(() => {
    if (previewMode) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { results: Record<string, ItemResult>; overallNotes: string };
      if (parsed.results && Object.keys(parsed.results).length > 0) {
        setResults(parsed.results);
      }
      if (parsed.overallNotes) {
        setOverallNotes(parsed.overallNotes);
      }
    } catch {
      // Corrupted draft — ignore
    }
  }, [draftKey, previewMode]);

  useEffect(() => {
    if (previewMode) return;
    if (Object.keys(results).length === 0 && !overallNotes) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ results, overallNotes }));
    } catch {
      // Storage full — ignore
    }
  }, [results, overallNotes, draftKey, previewMode]);

  // --------------------------------------------------------------------------
  // Pre-populate from last check for this apparatus
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    schedulingService
      .getLastCheckResults(template.id, template.apparatusId)
      .then((data) => {
        if (cancelled) return;
        setLastCheckData(data);
        // Only pre-populate if the user hasn't started filling in yet (no draft)
        if (Object.keys(results).length > 0) return;
        const seed: Record<string, ItemResult> = {};
        for (const comp of compartments) {
          for (const item of comp.items) {
            const prev = data[item.id];
            // The running on-truck count outranks the last check's number: it
            // carries everything used since, so a crew that pulled two at 03:00
            // opens this at 2 rather than at the 4 the last check recorded.
            const known = item.quantityOnTruck ?? prev?.quantity_found;
            if (item.checkType === 'quantity' && known != null) {
              // Seeded WITHOUT a status. The number is a starting point, not a
              // check — marking it pass/fail here would let a crew submit a
              // complete report having looked at nothing, and the progress
              // counter would agree with them.
              seed[item.id] = { status: 'not_checked', quantityFound: known };
            } else if ((item.checkType === 'level' || item.checkType === 'reading') && prev?.level_reading != null) {
              seed[item.id] = { status: 'not_checked', levelReading: prev.level_reading };
            }
          }
        }
        if (Object.keys(seed).length > 0) {
          setResults(seed);
        }
      })
      .catch(() => {
        // Non-critical — form works fine without previous data
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, template.apparatusId, previewMode]);

  // --------------------------------------------------------------------------
  // Pre-populate from existing incomplete check (resume flow)
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!existingCheckId || previewMode) return;
    let cancelled = false;
    schedulingService
      .getEquipmentCheck(existingCheckId)
      .then((record) => {
        if (cancelled) return;
        const seed: Record<string, ItemResult> = {};
        for (const item of record.items) {
          if (!item.templateItemId) continue;
          seed[item.templateItemId] = {
            status: item.status,
            quantityFound: item.quantityFound,
            levelReading: item.levelReading,
            serialNumber: item.serialNumber,
            lotNumber: item.lotNumber,
            serialFound: item.serialFound,
            lotFound: item.lotFound,
            notes: item.notes,
          };
        }
        if (Object.keys(seed).length > 0) {
          setResults(seed);
        }
        if (record.notes) {
          setOverallNotes(record.notes);
        }
      })
      .catch(() => {
        toast.error('Failed to load existing check data');
      });
    return () => {
      cancelled = true;
    };
  }, [existingCheckId, previewMode]);

  // --------------------------------------------------------------------------
  // Unsaved changes warning
  // --------------------------------------------------------------------------

  const hasProgress = checkedItems > 0;
  // True while any quantity still shows a number nobody has confirmed this
  // pass; the banner explains those and retires itself once they are gone.
  const hasCarriedCounts = useMemo(
    () =>
      checkableItems.some(
        (item) => results[item.id]?.quantityFound != null && results[item.id]?.status === 'not_checked'
      ),
    [checkableItems, results]
  );

  useEffect(() => {
    if (previewMode || !hasProgress) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [previewMode, hasProgress]);

  // --------------------------------------------------------------------------
  // Keyboard navigation — auto-advance to next item after marking pass/fail
  // --------------------------------------------------------------------------

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const focusNextItem = useCallback(
    (currentItemId: string) => {
      for (let cIdx = 0; cIdx < compartments.length; cIdx++) {
        const comp = compartments[cIdx];
        if (!comp || comp.isHeader) continue;
        const itemIdx = comp.items.findIndex((i) => i.id === currentItemId);
        if (itemIdx === -1) continue;

        // Try next checkable item in same compartment
        for (let i = itemIdx + 1; i < comp.items.length; i++) {
          const nextItem = comp.items[i];
          if (!nextItem || nextItem.checkType === 'header' || nextItem.checkType === 'text') continue;
          const nextEl = itemRefs.current[nextItem.id];
          if (nextEl) {
            nextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const passBtn = nextEl.querySelector<HTMLButtonElement>('[data-action="pass"]');
            passBtn?.focus();
          }
          return;
        }

        // Try first checkable item in next non-header compartment
        for (let nIdx = cIdx + 1; nIdx < compartments.length; nIdx++) {
          const nextComp = compartments[nIdx];
          if (!nextComp || nextComp.isHeader) continue;
          if (collapsedCompartments.has(nextComp.id)) {
            setCollapsedCompartments((prev) => {
              const next = new Set(prev);
              next.delete(nextComp.id);
              return next;
            });
          }
          const firstItem = nextComp.items.find((i) => i.checkType !== 'header' && i.checkType !== 'text');
          if (firstItem) {
            setTimeout(() => {
              const el = itemRefs.current[firstItem.id];
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const passBtn = el.querySelector<HTMLButtonElement>('[data-action="pass"]');
                passBtn?.focus();
              }
            }, 100);
          }
          return;
        }
        return;
      }
    },
    [compartments, collapsedCompartments]
  );

  const updateResultAndAdvance = useCallback(
    (itemId: string, patch: Partial<ItemResult>) => {
      updateResult(itemId, patch);
      if (patch.status === 'pass' || patch.status === 'fail') {
        setTimeout(() => focusNextItem(itemId), 150);
      }
    },
    [updateResult, focusNextItem]
  );

  /** Items in this compartment a crew still has to record something for. */
  const checkableIn = useCallback(
    (compartment: CheckTemplateCompartment) =>
      compartment.items.filter(
        (item) =>
          item.checkType !== 'header' && item.checkType !== 'text' && getExpirationStatus(item, today) !== 'expired'
      ),
    [today]
  );

  /**
   * Accept the numbers already shown, without changing any of them.
   *
   * The counterpart to setting par, and the one a crew wants far more often:
   * they have walked the compartment, the carried figures match what is in it,
   * and a shortfall they can see should stay a shortfall. Status still comes
   * from the number, so confirming 18 of 24 files a failure rather than
   * quietly passing it.
   */
  const confirmCountsInCompartment = useCallback(
    (compartment: CheckTemplateCompartment) => {
      setResults((prev) => {
        const next = { ...prev };
        for (const item of checkableIn(compartment)) {
          const existing = next[item.id];
          const required = item.requiredQuantity ?? item.expectedQuantity;
          const shown = existing?.quantityFound;
          const patch: Partial<ItemResult> = { status: 'pass' };
          if (item.checkType === 'quantity' && required != null) {
            // Nothing carried means nothing to confirm; leave it for the crew.
            if (shown == null) continue;
            patch.status = shown >= required ? 'pass' : 'fail';
          }
          next[item.id] = { status: 'not_checked', ...existing, ...patch };
        }
        return next;
      });
    },
    [checkableIn]
  );

  /** Quantity positions this compartment would have to *raise* to reach par. */
  const shortOfPar = useCallback(
    (compartment: CheckTemplateCompartment) =>
      checkableIn(compartment).filter((item) => {
        if (item.checkType !== 'quantity') return false;
        const required = item.requiredQuantity ?? item.expectedQuantity;
        const shown = results[item.id]?.quantityFound;
        return required != null && shown != null && shown < required;
      }),
    [checkableIn, results]
  );

  /**
   * Assert the whole compartment is at its required quantities.
   *
   * This writes par over whatever is shown, which is right when a crew means
   * it and wrong when they are using it as a fast path — a carried 18 of 24
   * became a recorded 24, putting six gauze on the record that are not in the
   * bag. It now says so first, and only when it would actually raise a count;
   * a compartment already at par is still one tap.
   */
  const setCompartmentToPar = useCallback(
    async (compartment: CheckTemplateCompartment) => {
      const raising = shortOfPar(compartment);
      if (raising.length > 0) {
        const ok = await confirm({
          title: raising.length === 1 ? 'Record this at full?' : `Record ${raising.length} items at full?`,
          message: <ShortfallList items={raising} results={results} />,
          confirmLabel: raising.length === 1 ? 'Yes, it is full' : 'Yes, they are full',
          cancelLabel: 'Keep the counts',
          variant: 'warning',
        });
        if (!ok) return;
      }
      setResults((prev) => {
        const next = { ...prev };
        for (const item of checkableIn(compartment)) {
          const existing = next[item.id];
          const patch: Partial<ItemResult> = { status: 'pass' };
          if (item.checkType === 'quantity') {
            const required = item.requiredQuantity ?? item.expectedQuantity;
            if (required != null) patch.quantityFound = required;
          }
          next[item.id] = { status: 'not_checked', ...existing, ...patch };
        }
        return next;
      });
    },
    // `results` is read to show each shortfall, so a stale closure here would
    // put last render's counts in front of the crew.
    [checkableIn, shortOfPar, confirm, results]
  );

  const hasQuantityItems = useCallback(
    (compartment: CheckTemplateCompartment) => compartment.items.some((item) => item.checkType === 'quantity'),
    []
  );

  // --------------------------------------------------------------------------
  // Submit
  // --------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (checkedItems < totalItems) {
      const uncheckedCount = totalItems - checkedItems;
      const confirmed = await confirm({
        title: 'Submit an incomplete check?',
        message: `${String(uncheckedCount)} of ${String(totalItems)} item${uncheckedCount === 1 ? '' : 's'} ${uncheckedCount === 1 ? 'has' : 'have'} not been checked. The report will be filed as incomplete.`,
        confirmLabel: 'Submit anyway',
        cancelLabel: 'Go back',
        variant: 'warning',
      });
      if (!confirmed) return;
    }

    setSubmitting(true);
    try {
      // Collect items with photo files for post-submit upload
      const itemsWithPhotos: { itemId: string; files: File[] }[] = [];

      const items: CheckItemResultSubmit[] = [];
      for (const compartment of compartments) {
        for (const rawItem of compartment.items) {
          if (rawItem.checkType === 'header') continue;
          // Reflect any in-check lot swap so the recorded snapshot carries the
          // fresh unit's lot/expiration rather than the pre-swap values.
          const item = applyOverride(rawItem);
          const result = results[item.id];

          // Detect serial/lot updates for date_lot items
          const serialFound = result?.serialFound || undefined;
          const lotFound = result?.lotFound || undefined;
          const expirationFound = result?.expirationFound || undefined;

          if (result?.photoFiles && result.photoFiles.length > 0) {
            itemsWithPhotos.push({
              itemId: item.id,
              files: result.photoFiles,
            });
          }

          items.push({
            template_item_id: item.id,
            compartment_name: storagePathByItemId.get(item.id) ?? compartment.name,
            item_name: item.name,
            check_type: item.checkType,
            status: result?.status || 'not_checked',
            quantity_found: result?.quantityFound,
            required_quantity: item.requiredQuantity ?? item.expectedQuantity,
            critical_minimum_quantity: item.criticalMinimumQuantity ?? undefined,
            level_reading: result?.levelReading,
            level_unit: item.levelUnit || undefined,
            serial_number: result?.serialNumber || undefined,
            lot_number: result?.lotNumber || undefined,
            serial_found: serialFound,
            lot_found: lotFound,
            expiration_found: expirationFound,
            is_expired: getExpirationStatus(item, today) === 'expired',
            expiration_date: item.expirationDate || undefined,
            notes: result?.notes || undefined,
          });
        }
      }

      const basePayload = {
        template_id: template.id,
        check_timing: template.checkTiming,
        items,
        notes: overallNotes || undefined,
      };

      // Offline: queue for later sync (shift-based only; standalone requires connectivity)
      if (!navigator.onLine && shiftId) {
        const payload: ShiftEquipmentCheckCreate = basePayload;
        await enqueueCheck(shiftId, payload, itemsWithPhotos);
        const count = await getPendingCount();
        setPendingQueueCount(count);
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* ignore */
        }
        toast.success('Check saved offline — will sync when connected');
        onComplete?.();
        return;
      }

      if (!navigator.onLine && !shiftId) {
        toast.error('Standalone checks require an internet connection');
        setSubmitting(false);
        return;
      }

      let checkResult;
      if (shiftId) {
        const payload: ShiftEquipmentCheckCreate = basePayload;
        checkResult = await schedulingService.submitEquipmentCheck(shiftId, payload);
      } else {
        const payload: StandaloneEquipmentCheckCreate = {
          ...basePayload,
          apparatus_id: template.apparatusId || undefined,
        };
        checkResult = await schedulingService.submitStandaloneCheck(payload);
      }

      // Upload photos to check items in parallel after submission
      if (itemsWithPhotos.length > 0 && checkResult.items) {
        await Promise.all(
          itemsWithPhotos.map(({ itemId, files }) => {
            const checkItem = checkResult.items?.find((ci) => ci.templateItemId === itemId);
            if (!checkItem) return Promise.resolve();
            return schedulingService.uploadCheckItemPhotos(checkResult.id, checkItem.id, files).catch(() => {
              toast.error(`Failed to upload photos for ${checkItem.itemName}`);
            });
          })
        );
      }

      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      toast.success('Equipment check submitted successfully');
      onComplete?.();
    } catch {
      // Network error during submit — fall back to offline queue
      try {
        const fallbackItems: CheckItemResultSubmit[] = [];
        const fallbackPhotos: { itemId: string; files: File[] }[] = [];
        for (const compartment of compartments) {
          for (const rawItem of compartment.items) {
            if (rawItem.checkType === 'header') continue;
            const item = applyOverride(rawItem);
            const result = results[item.id];
            if (result?.photoFiles && result.photoFiles.length > 0) {
              fallbackPhotos.push({ itemId: item.id, files: result.photoFiles });
            }
            fallbackItems.push({
              template_item_id: item.id,
              compartment_name: storagePathByItemId.get(item.id) ?? compartment.name,
              item_name: item.name,
              check_type: item.checkType,
              status: result?.status || 'not_checked',
              quantity_found: result?.quantityFound,
              required_quantity: item.requiredQuantity ?? item.expectedQuantity,
              critical_minimum_quantity: item.criticalMinimumQuantity ?? undefined,
              level_reading: result?.levelReading,
              level_unit: item.levelUnit || undefined,
              serial_number: result?.serialNumber || undefined,
              lot_number: result?.lotNumber || undefined,
              serial_found: result?.serialFound || undefined,
              lot_found: result?.lotFound || undefined,
              expiration_found: result?.expirationFound || undefined,
              is_expired: getExpirationStatus(item, today) === 'expired',
              expiration_date: item.expirationDate || undefined,
              notes: result?.notes || undefined,
            });
          }
        }
        const fallbackPayload: ShiftEquipmentCheckCreate = {
          template_id: template.id,
          check_timing: template.checkTiming,
          items: fallbackItems,
          notes: overallNotes || undefined,
        };
        if (shiftId) {
          await enqueueCheck(shiftId, fallbackPayload, fallbackPhotos);
        } else {
          toast.error('Failed to submit check. Please try again.');
          setSubmitting(false);
          return;
        }
        const count = await getPendingCount();
        setPendingQueueCount(count);
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* ignore */
        }
        toast.success('Connection lost — check queued for sync');
        onComplete?.();
      } catch {
        toast.error('Failed to submit equipment check');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // --------------------------------------------------------------------------
  // Render: Expiration Badge
  // --------------------------------------------------------------------------

  const renderExpirationBadge = (item: CheckTemplateItem) => {
    const status = getExpirationStatus(item, today);
    if (!status) return null;

    if (status === 'expired') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <AlertTriangle className="h-3 w-3" />
          EXPIRED
        </span>
      );
    }

    if (status === 'expiring_soon') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
          <Clock className="h-3 w-3" />
          Expiring
        </span>
      );
    }

    return null;
  };

  // --------------------------------------------------------------------------
  // Render: Check Input per Type
  // --------------------------------------------------------------------------

  const renderCheckInput = (item: CheckTemplateItem) => {
    const result = results[item.id];
    const currentStatus = result?.status ?? 'not_checked';
    const expirationStatus = getExpirationStatus(item, today);
    const isExpired = expirationStatus === 'expired';

    // Auto-fail expired items
    if (isExpired && currentStatus !== 'fail') {
      queueMicrotask(() => updateResult(item.id, { status: 'fail' }));
    }

    const effectiveStatus = isExpired ? 'fail' : currentStatus;

    /**
     * Pass or Fail with nothing between forced a crew to file a legitimately
     * absent tool as a fault — and the compliance report then counted it as
     * one. "Not on truck" is the third honest answer: it counts as answered,
     * never as failed, and reads as itself on the report.
     *
     * It is not offered for an expired item: the department's own record says
     * the unit aboard is out of date, and that verdict is the server's to make
     * (see `_compute_check_status`), not something an answer here can retire.
     */
    const notApplicableButton = isExpired ? null : (
      <button
        type="button"
        data-action="not_applicable"
        onClick={() => updateResultAndAdvance(item.id, { status: 'not_applicable' })}
        className={`flex min-h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
          effectiveStatus === 'not_applicable'
            ? 'bg-theme-text-muted text-white'
            : 'border-theme-surface-border text-theme-text-muted hover:border-theme-text-muted hover:text-theme-text-secondary border'
        }`}
        title="Not on the truck, or does not apply to this apparatus"
      >
        <MinusCircle className="h-4 w-4" aria-hidden="true" />
        Not on truck
      </button>
    );

    const passFailButtons = (
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-action="pass"
          onClick={() => updateResultAndAdvance(item.id, { status: 'pass' })}
          disabled={isExpired}
          className={`flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
            effectiveStatus === 'pass'
              ? 'bg-green-600 text-white'
              : 'border-theme-surface-border text-theme-text-muted border hover:border-green-500 hover:text-green-600'
          } ${isExpired ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <CheckCircle className="h-4 w-4" />
          Pass
        </button>
        <button
          type="button"
          data-action="fail"
          onClick={() => updateResultAndAdvance(item.id, { status: 'fail' })}
          className={`flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
            effectiveStatus === 'fail'
              ? 'bg-red-600 text-white'
              : 'border-theme-surface-border text-theme-text-muted border hover:border-red-500 hover:text-red-600'
          }`}
        >
          <XCircle className="h-4 w-4" />
          Fail
        </button>
        {notApplicableButton}
      </div>
    );

    switch (item.checkType) {
      case 'pass_fail':
      case 'functional':
        return passFailButtons;

      case 'present':
        return (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-action="pass"
              onClick={() => updateResultAndAdvance(item.id, { status: 'pass' })}
              className={`flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                effectiveStatus === 'pass'
                  ? 'bg-green-600 text-white'
                  : 'border-theme-surface-border text-theme-text-muted border hover:border-green-500 hover:text-green-600'
              }`}
            >
              <Eye className="h-4 w-4" />
              Present
            </button>
            <button
              type="button"
              data-action="fail"
              onClick={() => updateResultAndAdvance(item.id, { status: 'fail' })}
              className={`flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                effectiveStatus === 'fail'
                  ? 'bg-red-600 text-white'
                  : 'border-theme-surface-border text-theme-text-muted border hover:border-red-500 hover:text-red-600'
              }`}
            >
              <XCircle className="h-4 w-4" />
              Missing
            </button>
            {notApplicableButton}
          </div>
        );

      case 'quantity': {
        const required = item.requiredQuantity ?? item.expectedQuantity;
        const expected = item.expectedQuantity ?? required;
        const criticalMin = item.criticalMinimumQuantity;
        const currentQty = result?.quantityFound ?? 0;
        const isAtPar = required != null && currentQty >= required;
        const isCritical = criticalMin != null && currentQty <= criticalMin;
        const hasBeenSet = result?.quantityFound != null;
        // Seeded from the running count but not yet affirmed by this crew. The
        // number is shown so they only correct what changed; it is not a check.
        const isCarriedOver = hasBeenSet && currentStatus === 'not_checked';
        const unit = item.unitOfMeasure;
        const prevQty = lastCheckData?.[item.id]?.quantity_found;

        const getQtyColor = () => {
          if (!hasBeenSet || isCarriedOver) return 'text-theme-text-muted';
          // Expired outranks the count. Two of two expired units meet the
          // number and are still nothing the crew can use, so this must not
          // read as the healthy state.
          if (isExpired) return 'text-red-600 dark:text-red-400 font-bold';
          if (isCritical) return 'text-red-600 dark:text-red-400 font-bold';
          if (!isAtPar) return 'text-orange-500 dark:text-orange-400 font-medium';
          return 'text-green-600 dark:text-green-400 font-medium';
        };

        const setQuantity = (qty: number) => {
          const clamped = Math.max(0, qty);
          updateResult(item.id, {
            quantityFound: clamped,
            status: required != null ? (clamped >= required ? 'pass' : 'fail') : 'pass',
          });
        };

        return (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5 text-xs">
              {expected != null && (
                <span className={`block ${getQtyColor()}`}>
                  {hasBeenSet ? currentQty : '—'}/{expected}
                  {unit ? ` ${unit}` : ''}
                </span>
              )}

              {hasBeenSet && isCritical && (
                <span className="block text-[10px] font-semibold text-red-600 dark:text-red-400">
                  CRITICAL — below minimum ({criticalMin})
                </span>
              )}
              {hasBeenSet && !isAtPar && !isCritical && required != null && (
                <span className="block text-[10px] text-orange-500">Below required ({required})</span>
              )}
              {prevQty != null && hasBeenSet && currentQty !== prevQty && (
                <span className="text-theme-text-muted block text-[10px]">Last: {prevQty}</span>
              )}
            </div>
            <div className="flex items-center gap-0">
              <button
                type="button"
                onClick={() => setQuantity(currentQty - 1)}
                disabled={isExpired || currentQty <= 0}
                className="border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-secondary active:bg-theme-surface-border flex h-11 w-11 items-center justify-center rounded-l-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={`Decrease ${item.name} quantity`}
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                id={`qty-${item.id}`}
                type="number"
                min="0"
                inputMode="numeric"
                className={`bg-theme-surface h-11 w-14 [appearance:textfield] border-y text-center text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none focus:ring-inset [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                  hasBeenSet && isCritical
                    ? 'border-2 border-red-600 text-red-600 dark:text-red-400'
                    : hasBeenSet && !isAtPar
                      ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                      : 'border-theme-surface-border text-theme-text-primary'
                }`}
                value={hasBeenSet ? currentQty : ''}
                onFocus={() => {
                  // Touching the field is the crew looking at it. That counts
                  // as the check for a carried number they agree with, which
                  // is why no per-row "confirm" prompt is needed.
                  if (isCarriedOver) setQuantity(currentQty);
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    updateResult(item.id, {
                      quantityFound: undefined,
                      status: 'not_checked',
                    });
                  } else {
                    setQuantity(Number(val));
                  }
                }}
                disabled={isExpired}
              />
              <button
                type="button"
                onClick={() => setQuantity(currentQty + 1)}
                disabled={isExpired}
                className="border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-secondary active:bg-theme-surface-border flex h-11 w-11 items-center justify-center rounded-r-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={`Increase ${item.name} quantity`}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      }

      case 'level': {
        const belowMin = item.minLevel != null && result?.levelReading != null && result.levelReading < item.minLevel;

        return (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label htmlFor={`level-${item.id}`} className="text-theme-text-secondary text-xs whitespace-nowrap">
                Reading:
              </label>
              <input
                id={`level-${item.id}`}
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                className={`text-theme-text-primary bg-theme-surface min-h-[48px] w-24 rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none ${
                  belowMin ? 'border-red-500 focus:ring-red-500' : 'border-theme-surface-border focus:ring-blue-500'
                }`}
                value={result?.levelReading ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const reading = val ? Number(val) : undefined;
                  updateResult(item.id, {
                    levelReading: reading,
                    status:
                      reading != null && item.minLevel != null
                        ? reading >= item.minLevel
                          ? 'pass'
                          : 'fail'
                        : reading != null
                          ? 'pass'
                          : 'not_checked',
                  });
                }}
              />
              <span className="text-theme-text-muted text-xs">
                {item.levelUnit ?? ''}
                {item.minLevel != null && ` (min: ${item.minLevel})`}
              </span>
            </div>
            {passFailButtons}
          </div>
        );
      }

      case 'date_lot': {
        const showSerialUpdate = expandedSerialUpdate.has(item.id);
        return (
          <div className="space-y-2">
            {/* Current serial/lot display */}
            {(item.serialNumber || item.lotNumber) && (
              <div className="text-theme-text-muted bg-theme-surface-secondary flex items-center gap-3 rounded-lg px-3 py-2 text-xs">
                {item.serialNumber && (
                  <span>
                    S/N: <span className="font-mono">{item.serialNumber}</span>
                  </span>
                )}
                {item.lotNumber && (
                  <span>
                    Lot: <span className="font-mono">{item.lotNumber}</span>
                  </span>
                )}
              </div>
            )}

            {/* Verify serial/lot inputs */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor={`serial-${item.id}`} className="text-theme-text-secondary mb-1 block text-xs">
                  Serial #
                </label>
                <input
                  id={`serial-${item.id}`}
                  type="text"
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface min-h-[48px] w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder={item.serialNumber ?? 'Serial number'}
                  value={result?.serialNumber ?? ''}
                  onChange={(e) => updateResult(item.id, { serialNumber: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`lot-${item.id}`} className="text-theme-text-secondary mb-1 block text-xs">
                  Lot #
                </label>
                <input
                  id={`lot-${item.id}`}
                  type="text"
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface min-h-[48px] w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder={item.lotNumber ?? 'Lot number'}
                  value={result?.lotNumber ?? ''}
                  onChange={(e) => updateResult(item.id, { lotNumber: e.target.value })}
                />
              </div>
            </div>

            {/* Update serial/lot toggle — for when item has been swapped */}
            <button
              type="button"
              onClick={() => toggleSerialUpdate(item.id)}
              className="min-h-[32px] text-xs font-medium text-blue-600 transition-colors hover:text-blue-700"
            >
              {showSerialUpdate ? 'Cancel update' : 'Item swapped? Update serial/lot on template'}
            </button>

            {showSerialUpdate && (
              <div className="space-y-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Enter the new serial/lot numbers{item.hasExpiration ? ' and expiration' : ''}. The template will be
                  automatically updated.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`new-serial-${item.id}`} className="text-theme-text-secondary mb-1 block text-xs">
                      New Serial #
                    </label>
                    <input
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      id={`new-serial-${item.id}`}
                      type="text"
                      className="text-theme-text-primary bg-theme-surface min-h-[48px] w-full rounded-lg border border-blue-500/30 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder="New serial number"
                      value={result?.serialFound ?? ''}
                      onChange={(e) =>
                        updateResult(item.id, {
                          serialFound: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor={`new-lot-${item.id}`} className="text-theme-text-secondary mb-1 block text-xs">
                      New Lot #
                    </label>
                    <input
                      id={`new-lot-${item.id}`}
                      type="text"
                      className="text-theme-text-primary bg-theme-surface min-h-[48px] w-full rounded-lg border border-blue-500/30 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder="New lot number"
                      value={result?.lotFound ?? ''}
                      onChange={(e) =>
                        updateResult(item.id, {
                          lotFound: e.target.value,
                        })
                      }
                    />
                  </div>
                  {item.hasExpiration && (
                    <div>
                      <label
                        htmlFor={`new-expiration-${item.id}`}
                        className="text-theme-text-secondary mb-1 block text-xs"
                      >
                        New expiration
                      </label>
                      <input
                        id={`new-expiration-${item.id}`}
                        type="date"
                        className="text-theme-text-primary bg-theme-surface min-h-[48px] w-full rounded-lg border border-blue-500/30 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={result?.expirationFound ?? ''}
                        onChange={(e) =>
                          updateResult(item.id, {
                            expirationFound: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {passFailButtons}
          </div>
        );
      }

      case 'reading':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label htmlFor={`reading-${item.id}`} className="text-theme-text-secondary text-xs whitespace-nowrap">
                Reading:
              </label>
              <input
                id={`reading-${item.id}`}
                type="number"
                step="0.01"
                inputMode="decimal"
                className="border-theme-surface-border text-theme-text-primary bg-theme-surface min-h-[48px] w-32 rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                value={result?.levelReading ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  updateResult(item.id, {
                    levelReading: val ? Number(val) : undefined,
                    status: val ? 'pass' : 'not_checked',
                  });
                }}
              />
            </div>
            {passFailButtons}
          </div>
        );

      case 'text':
      case 'header':
        return null;

      default:
        return passFailButtons;
    }
  };

  // --------------------------------------------------------------------------
  // Render: Check Item (phone-first, large touch targets)
  // --------------------------------------------------------------------------

  const renderCheckItem = (rawItem: CheckTemplateItem) => {
    const item = applyOverride(rawItem);
    if (item.checkType === 'header') {
      return (
        <div key={item.id} className="pt-3 first:pt-0">
          <div className="border-theme-surface-border border-b pb-2">
            <h3 className="text-theme-text-primary text-sm font-bold">{item.name}</h3>
          </div>
          {item.description && <p className="text-theme-text-muted mt-1 text-[11px]">{item.description}</p>}
        </div>
      );
    }

    if (item.checkType === 'text') {
      return (
        <div key={item.id} className="border-theme-surface-border bg-theme-surface rounded-lg border p-4">
          <div className="flex items-start gap-2">
            <MessageSquare className="text-theme-text-muted mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-theme-text-primary text-sm font-medium">{item.name}</p>
              {item.description && <p className="text-theme-text-muted mt-0.5 text-xs">{item.description}</p>}
            </div>
          </div>
        </div>
      );
    }

    const result = results[item.id];
    const effectiveStatus = result?.status ?? 'not_checked';
    const showNotesField = expandedNotes.has(item.id);
    const TypeIcon = CHECK_TYPE_ICONS[item.checkType] ?? CheckCircle;
    const isQuantity = item.checkType === 'quantity';

    return (
      <div
        key={item.id}
        ref={(el) => {
          itemRefs.current[item.id] = el;
        }}
        className={`rounded-lg border p-4 transition-colors ${isQuantity ? 'space-y-1' : 'space-y-3'} ${
          effectiveStatus === 'pass'
            ? 'border-green-500/30 bg-green-500/5'
            : effectiveStatus === 'fail'
              ? 'border-red-500/30 bg-red-500/5'
              : effectiveStatus === 'not_applicable'
                ? 'border-theme-surface-border bg-theme-surface-hover/40'
                : 'border-theme-surface-border bg-theme-surface'
        }`}
      >
        {/* Item header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {!isQuantity && <TypeIcon className="text-theme-text-muted h-4 w-4 flex-shrink-0" />}
              <span className="text-theme-text-primary text-sm font-medium">{item.name}</span>
              {/* REQUIRED was stamped on every item, in red — the same red a
                  failed item wears — which told the reader nothing and spent the
                  page's one alarm colour. The few optional ones are the news. */}
              {!item.isRequired && <span className="text-theme-text-muted text-[10px] font-medium">Optional</span>}
              {renderExpirationBadge(item)}
            </div>
            {swapOverrides[item.id] && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                <PackageCheck className="h-3 w-3" aria-hidden="true" />
                Swapped in
                {swapOverrides[item.id]?.lotNumber ? ` Lot ${swapOverrides[item.id]?.lotNumber}` : ' fresh stock'}
                {swapOverrides[item.id]?.expirationDate
                  ? ` · exp ${formatCalendarDate(swapOverrides[item.id]?.expirationDate, { year: 'numeric', month: 'numeric', day: 'numeric' })}`
                  : ''}
              </p>
            )}
            {item.description && (
              <p className={`text-theme-text-muted mt-0.5 text-xs ${isQuantity ? '' : 'ml-6'}`}>{item.description}</p>
            )}
            {/* Show the caption only for a type we have words for. Falling back
                to the raw value printed an internal token under the item name —
                a template stored with check_type "presence" captioned every
                item "presence", which reads as a typo to the crew. An
                unrecognised type is now silent rather than confusing; the
                backend rejects new ones, so this is for templates stored
                before it did. */}
            {!isQuantity && CHECK_TYPE_LABELS[item.checkType] && (
              <div className="mt-1 ml-6 flex items-center gap-2">
                <span className="text-theme-text-muted text-[10px]">{CHECK_TYPE_LABELS[item.checkType]}</span>
              </div>
            )}
            {item.imageUrl && (
              <div className="mt-2">
                <img
                  src={item.imageUrl}
                  alt={`Reference: ${item.name}`}
                  className="border-theme-surface-border max-h-28 w-auto cursor-pointer rounded-md border object-contain transition-opacity hover:opacity-80"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(item.imageUrl, '_blank', 'noopener');
                  }}
                  loading="lazy"
                />
              </div>
            )}
          </div>
        </div>

        {/* Check input area */}
        {renderCheckInput(item)}

        {/* Notes + Photo */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleNotes(item.id)}
            aria-expanded={showNotesField}
            className="text-theme-text-muted hover:text-theme-text-secondary flex min-h-[36px] items-center gap-1 text-xs transition-colors"
          >
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            {showNotesField ? 'Hide' : 'Note'}
            {(result?.photoFiles?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 font-medium text-blue-600">
                <Camera className="h-3 w-3" aria-hidden="true" />
                {result?.photoFiles?.length}
              </span>
            )}
          </button>
          {/* Offered whenever the item is linked to inventory, not only when it
              is near its date. Expiry is one reason a unit comes off a truck;
              used, damaged, contaminated, missing and recalled are the others,
              and gating on the date left a crew holding an empty bracket with
              ready stock on the shelf and no way to reach it. */}
          {item.inventoryItemId && (
            <button
              type="button"
              onClick={() => {
                void openSwap(item);
              }}
              className={`flex min-h-[36px] items-center gap-1 text-xs font-medium transition-colors ${
                getExpirationStatus(item, today) === 'expired' || getExpirationStatus(item, today) === 'expiring_soon'
                  ? 'text-blue-600 hover:text-blue-700'
                  : 'text-theme-text-muted hover:text-theme-text-secondary'
              }`}
            >
              <Repeat className="h-3 w-3" aria-hidden="true" />
              Swap
            </button>
          )}
          {/* An expiration can be set on any check type, but only date_lot has
              the serial/lot update panel. Without this, an expired item of any
              other type could never record its replacement and would fail
              every check until an admin edited the template. */}
          {item.checkType !== 'date_lot' && item.hasExpiration && (item.lotsAboard?.length ?? 0) === 0 && (
            <button
              type="button"
              onClick={() => toggleSerialUpdate(item.id)}
              aria-expanded={expandedSerialUpdate.has(item.id)}
              className="text-theme-text-muted hover:text-theme-text-secondary flex min-h-[36px] items-center gap-1 text-xs transition-colors"
            >
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {expandedSerialUpdate.has(item.id) ? 'Cancel' : 'Replaced — new date'}
            </button>
          )}
        </div>
        {item.checkType !== 'date_lot' &&
          item.hasExpiration &&
          (item.lotsAboard?.length ?? 0) === 0 &&
          expandedSerialUpdate.has(item.id) && (
            <div className="space-y-1 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
              <label
                htmlFor={`replaced-expiration-${item.id}`}
                className="block text-xs text-blue-700 dark:text-blue-400"
              >
                Expiration on the replacement — the template will be updated to match.
              </label>
              <input
                id={`replaced-expiration-${item.id}`}
                type="date"
                className="text-theme-text-primary bg-theme-surface min-h-[48px] w-full rounded-lg border border-blue-500/30 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none sm:w-56"
                value={result?.expirationFound ?? ''}
                onChange={(e) => updateResult(item.id, { expirationFound: e.target.value })}
              />
            </div>
          )}
        {(item.lotsAboard?.length ?? 0) > 0 && (
          <div className="border-theme-surface-border space-y-2 rounded-lg border p-3">
            <p className="text-theme-text-secondary text-xs font-medium">
              Lots aboard — check each date against the box
            </p>
            <LotsAboardPanel
              lots={item.lotsAboard ?? []}
              busy={lotBusyId === item.id}
              onSave={(lotId, changes) => correctLot(item, lotId, changes)}
              onRemove={(lotId) => correctLot(item, lotId, { quantity: 0 })}
            />
          </div>
        )}
        {showNotesField && (
          <textarea
            rows={2}
            className="border-theme-surface-border bg-theme-surface text-theme-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder="Notes for this item..."
            aria-label={`Notes for ${item.name}`}
            value={result?.notes ?? ''}
            onChange={(e) => updateResult(item.id, { notes: e.target.value })}
          />
        )}
        {/* A photo is evidence for the note beside it, so it opens with the
            note rather than from a control of its own — four buttons on a row
            left nothing readable on a phone. */}
        {showNotesField && (
          <div className="space-y-2">
            {/* Photo thumbnails */}
            {result?.photoUrls && result.photoUrls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {result.photoUrls.map((url, idx) => (
                  <div key={idx} className="group relative">
                    <img
                      src={url}
                      alt={`Photo ${idx + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="border-theme-surface-border h-16 w-16 rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(item.id, idx)}
                      className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-sm text-white opacity-100 transition-opacity focus:opacity-100 focus:ring-2 focus:ring-red-500 focus:ring-offset-1 focus:outline-none sm:h-6 sm:w-6 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label={`Remove photo ${idx + 1}`}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Add photo button */}
            {(result?.photoFiles?.length ?? 0) < 3 && (
              <>
                <input
                  ref={(el) => {
                    photoInputRefs.current[item.id] = el;
                  }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  aria-label={`Upload photo for ${item.name}`}
                  onChange={(e) => handlePhotoSelect(item.id, e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => photoInputRefs.current[item.id]?.click()}
                  className="border-theme-surface-border text-theme-text-muted flex min-h-[40px] items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs transition-colors hover:border-blue-500 hover:text-blue-600"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  Add photo (max 3)
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // Render: Flat Scrollable View — all compartments inline with items
  // --------------------------------------------------------------------------

  const renderFlatView = () => {
    const sections: {
      header?: (typeof compartments)[number];
      comps: { comp: (typeof compartments)[number]; idx: number }[];
    }[] = [];
    let currentSection: (typeof sections)[number] = { comps: [] };

    compartments.forEach((comp, idx) => {
      if (comp.isHeader) {
        if (currentSection.comps.length > 0 || currentSection.header) {
          sections.push(currentSection);
        }
        currentSection = { header: comp, comps: [] };
      } else {
        currentSection.comps.push({ comp, idx });
      }
    });
    if (currentSection.comps.length > 0 || currentSection.header) {
      sections.push(currentSection);
    }

    return (
      <div className="space-y-4">
        {sections.map((section, sIdx) => (
          <div key={section.header?.id ?? `section-${sIdx}`} className="space-y-3">
            {section.header && (
              <div className="border-theme-surface-border border-b pt-2 pb-1">
                <h3 className="text-theme-text-primary text-sm font-bold">{section.header.name}</h3>
                {section.header.description && (
                  <p className="text-theme-text-muted mt-0.5 text-[10px]">{section.header.description}</p>
                )}
              </div>
            )}

            {section.comps.map(({ comp }) => {
              const isCollapsed = collapsedCompartments.has(comp.id);
              const status = getCompartmentStatus(comp, results);
              const checkable = comp.items.filter((i) => i.checkType !== 'header' && i.checkType !== 'text');
              const checked = checkable.filter((i) => {
                const r = results[i.id];
                return r && r.status !== 'not_checked';
              }).length;

              return (
                <div key={comp.id}>
                  {/* Compartment header — collapsible */}
                  {/* Sticky: the compartment heading scrolled away, so a member
                      a dozen items into "Cab" had nothing on screen saying so. */}
                  <button
                    type="button"
                    onClick={() => toggleCompartmentCollapse(comp.id)}
                    className={`bg-theme-bg sticky top-[76px] z-10 w-full rounded-xl border-2 p-4 text-left transition-all active:scale-[0.98] ${STATUS_COLORS[status]}`}
                    aria-expanded={!isCollapsed}
                    aria-label={`${comp.name}, ${checked} of ${checkable.length} checked, ${STATUS_LABELS[status] ?? ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-base leading-tight font-bold">{comp.name}</p>
                        {comp.description && <p className="mt-0.5 truncate text-xs opacity-75">{comp.description}</p>}
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs opacity-75">
                            {checked}/{checkable.length} checked
                          </span>
                          {status === 'complete' && <CheckCircle className="h-4 w-4" aria-hidden="true" />}
                          {status === 'has_failures' && <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                        </div>
                      </div>
                      {isCollapsed ? (
                        <ChevronDown className="h-5 w-5 flex-shrink-0 opacity-60" aria-hidden="true" />
                      ) : (
                        <ChevronUp className="h-5 w-5 flex-shrink-0 opacity-60" aria-hidden="true" />
                      )}
                    </div>
                  </button>

                  {/* Items — visible when expanded */}
                  {!isCollapsed && (
                    <div className="mt-3 ml-1 space-y-3">
                      {/* Two bulk actions for a compartment that carries
                          quantities, because "the numbers are right" and "it is
                          all full" are different claims and only one of them
                          used to exist. Confirming leads: it is the common case
                          and the one that cannot record stock nobody has. */}
                      {!previewMode && checked < checkable.length && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {hasQuantityItems(comp) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmCountsInCompartment(comp);
                              }}
                              aria-label={`Confirm the counts shown in ${comp.name}`}
                              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs font-medium whitespace-nowrap text-green-700 transition-colors hover:bg-green-500/20 dark:text-green-400"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Confirm Counts
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (hasQuantityItems(comp)) {
                                void setCompartmentToPar(comp);
                              } else {
                                confirmCountsInCompartment(comp);
                              }
                            }}
                            aria-label={
                              hasQuantityItems(comp)
                                ? `Set all items in ${comp.name} to par`
                                : `Mark all items in ${comp.name} as passed`
                            }
                            className={`flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                              hasQuantityItems(comp)
                                ? 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                                : 'border-green-500/30 bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:text-green-400'
                            }`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {hasQuantityItems(comp) ? 'Set All to Par' : 'Pass All'}
                          </button>
                        </div>
                      )}

                      {comp.items.length === 0 && (
                        <p className="text-theme-text-muted py-4 text-center text-sm italic">
                          No items in this compartment.
                        </p>
                      )}
                      {comp.items.map((item) => renderCheckItem(item))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Overall notes + submit */}
        {!previewMode && (
          <div className="space-y-3 pt-2">
            <div>
              <label htmlFor="overall-notes" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                Overall Notes
              </label>
              <textarea
                id="overall-notes"
                rows={3}
                className="border-theme-surface-border bg-theme-surface text-theme-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Any overall notes or observations..."
                value={overallNotes}
                onChange={(e) => setOverallNotes(e.target.value)}
              />
            </div>

            {/* Sticky: on a real engine inventory Submit sat several screens
                below the last item, and the count of what was still unanswered
                was at the very top. Both travel with the crew now. */}
            <div className="bg-theme-bg border-theme-surface-border action-bar-safe sticky bottom-0 z-20 -mx-3 space-y-2 border-t px-3">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting || !allRequiredChecked}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isOnline ? 'Submitting...' : 'Saving offline...'}
                  </>
                ) : (
                  <>
                    {isOnline ? <CheckCircle className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    {isOnline ? 'Submit Report' : 'Save Offline'}
                  </>
                )}
              </button>

              {!allRequiredChecked && (
                <p className="text-theme-text-muted text-center text-xs">
                  <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {unansweredRequiredCount} required item{unansweredRequiredCount === 1 ? '' : 's'} still to answer.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // Main Render
  // --------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-lg space-y-4 px-3 pb-12">
      {/* Offline banner */}
      {!isOnline && !previewMode && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300">
          <WifiOff className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1">You&apos;re offline. Checks will be saved locally and synced when connected.</span>
        </div>
      )}

      {/* Pending sync indicator */}
      {pendingQueueCount > 0 && !previewMode && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-800 dark:text-blue-300">
          <span className="flex items-center gap-2">
            {syncStatus === 'syncing' ? (
              <RefreshCw className="h-4 w-4 flex-shrink-0 animate-spin" />
            ) : (
              <Clock className="h-4 w-4 flex-shrink-0" />
            )}
            {syncStatus === 'syncing' ? 'Syncing queued checks…' : `${pendingQueueCount} check(s) waiting to sync`}
          </span>
          {isOnline && syncStatus !== 'syncing' && (
            <button
              type="button"
              onClick={() => void syncPendingChecks()}
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Sync now
            </button>
          )}
        </div>
      )}

      {/* Header. Sticky, because progress used to live only at the top: on a
          real engine inventory a member scrolled to the very end to find out
          they had missed something in the cab. It also carries the shift — the
          template name alone is identical for two trucks running one template. */}
      <div className="bg-theme-bg sticky top-0 z-20 -mx-3 space-y-2 px-3 pt-2 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface shrink-0 rounded-lg p-2 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-theme-text-primary truncate text-lg font-bold">{template.name}</h1>
                {timingLabel && (
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      shiftContext?.checkTiming === 'start_of_shift'
                        ? 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400'
                        : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {timingLabel}
                  </span>
                )}
              </div>
              {shiftContextLine && <p className="text-theme-text-muted truncate text-xs">{shiftContextLine}</p>}
            </div>
          </div>
          <span className="text-theme-text-secondary shrink-0 text-sm font-medium">
            {checkedItems}/{totalItems}
          </span>
        </div>

        {/* Progress bar */}
        <div
          className="bg-theme-surface-border h-2.5 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${checkedItems} of ${totalItems} items checked`}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              progressPercent === 100 ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Said once, at the top, rather than on every row it applies to: the
          carry-over is a standing rule about the whole check, and repeating it
          per item turned one sentence into sixty pieces of chrome. */}
      {hasCarriedCounts && (
        <div className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-secondary mx-4 mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
          <span>
            Counts are carried over from the last recorded count. Change what is different — anything you leave alone
            still needs a tap to confirm you looked.
          </span>
        </div>
      )}

      {/* Content */}
      {renderFlatView()}

      {/* Lot swap modal — pick a ready replacement to put on the apparatus */}
      {swapTarget && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
          <div className="bg-theme-surface border-theme-surface-border flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl">
            <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-theme-text-primary truncate text-sm font-semibold">Replace from ready stock</h3>
                <p className="text-theme-text-muted truncate text-xs">{swapTarget.name}</p>
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
              {swapLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
                </div>
              ) : swapLots.length === 0 ? (
                <p className="text-theme-text-muted py-8 text-center text-sm">
                  No ready stock on hand. Ask the supply officer to add stock for this item.
                </p>
              ) : (
                swapLots.map((lot) => (
                  <div
                    key={lot.id}
                    className="border-theme-surface-border flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-theme-text-primary truncate text-sm font-medium">
                        {lot.lot_number || 'No lot #'}
                      </p>
                      <p className="text-theme-text-muted text-xs">
                        {lot.expiration_date
                          ? `Exp ${formatCalendarDate(lot.expiration_date, { year: 'numeric', month: 'numeric', day: 'numeric' })}`
                          : 'No expiration'}{' '}
                        · {lot.quantity} ready
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={swapping}
                      onClick={() => {
                        void doSwap(lot);
                      }}
                      className="btn-primary btn-sm inline-flex shrink-0 items-center gap-1 disabled:opacity-50"
                    >
                      {swapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                      Swap in
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

export { EquipmentCheckForm };
export default EquipmentCheckForm;
