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
  Minus,
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
import { formatDate } from '../../utils/dateFormatting';
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
  LastCheckItemResult,
} from '../../modules/scheduling/types/equipmentCheck';
import { CHECK_TYPE_LABELS } from '../../modules/scheduling/types/equipmentCheck';
import { flattenCompartmentTree } from '../../modules/scheduling/utils/compartmentTree';

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
}

interface ItemResult {
  status: 'pass' | 'fail' | 'not_checked';
  quantityFound?: number | undefined;
  levelReading?: number | undefined;
  serialNumber?: string | undefined;
  lotNumber?: string | undefined;
  serialFound?: string | undefined;
  lotFound?: string | undefined;
  photoUrls?: string[] | undefined;
  photoFiles?: File[] | undefined;
  notes?: string | undefined;
}

// ============================================================================
// Helpers
// ============================================================================

function getExpirationStatus(item: CheckTemplateItem): 'ok' | 'expiring_soon' | 'expired' | null {
  if (!item.hasExpiration || !item.expirationDate) return null;

  const now = new Date();
  const expDate = new Date(item.expirationDate);

  if (expDate < now) return 'expired';

  const warningMs = (item.expirationWarningDays ?? 30) * 24 * 60 * 60 * 1000;
  if (expDate.getTime() - now.getTime() < warningMs) return 'expiring_soon';

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
}) => {
  const tz = useTimezone();
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  // Lot swaps performed during this check: override the deployed item's lot /
  // expiration so the badge reflects the fresher unit that was swapped in.
  const [swapOverrides, setSwapOverrides] = useState<Record<string, { lotNumber?: string; expirationDate?: string }>>(
    {}
  );
  const [swapTarget, setSwapTarget] = useState<CheckTemplateItem | null>(null);
  const [swapLots, setSwapLots] = useState<InventoryLot[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [collapsedCompartments, setCollapsedCompartments] = useState<Set<string>>(new Set());
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [expandedPhotos, setExpandedPhotos] = useState<Set<string>>(new Set());
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

  const allRequiredChecked = checkableItems
    .filter((item) => item.isRequired)
    .every((item) => {
      const result = results[item.id];
      return result && result.status !== 'not_checked';
    });

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

  // Apply any in-check lot swap to an item so the badge and expiration reflect
  // the fresher unit that was swapped in (without needing a template re-fetch).
  const applyOverride = useCallback(
    (item: CheckTemplateItem): CheckTemplateItem => {
      const o = swapOverrides[item.id];
      if (!o) return item;
      return {
        ...item,
        ...(o.lotNumber !== undefined ? { lotNumber: o.lotNumber } : {}),
        ...(o.expirationDate !== undefined ? { hasExpiration: true, expirationDate: o.expirationDate } : {}),
      };
    },
    [swapOverrides]
  );

  const openSwap = useCallback(async (item: CheckTemplateItem) => {
    if (!item.inventoryItemId) return;
    setSwapTarget(item);
    setSwapLots([]);
    setSwapLoading(true);
    try {
      const lots = await inventoryService.getItemLots(item.inventoryItemId);
      // Freshest (latest expiration) first — that's the best unit to swap in.
      const inStock = lots
        .filter((l) => l.quantity > 0)
        .sort((a, b) => (b.expiration_date ?? '').localeCompare(a.expiration_date ?? ''));
      setSwapLots(inStock);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load ready stock'));
    } finally {
      setSwapLoading(false);
    }
  }, []);

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
        // Record the swapped-in lot as the found lot and clear the auto-fail.
        updateResult(swapTarget.id, {
          lotFound: res.lotNumber,
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

  const togglePhotos = useCallback((itemId: string) => {
    setExpandedPhotos((prev) => {
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
            if (!prev) continue;
            if (item.checkType === 'quantity' && prev.quantity_found != null) {
              const required = item.requiredQuantity ?? item.expectedQuantity;
              seed[item.id] = {
                status: required != null ? (prev.quantity_found >= required ? 'pass' : 'fail') : 'pass',
                quantityFound: prev.quantity_found,
              };
            } else if ((item.checkType === 'level' || item.checkType === 'reading') && prev.level_reading != null) {
              const belowMin =
                item.checkType === 'level' && item.minLevel != null && prev.level_reading < item.minLevel;
              seed[item.id] = {
                status: belowMin ? 'fail' : 'pass',
                levelReading: prev.level_reading,
              };
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

  const passAllInCompartment = useCallback((compartment: CheckTemplateCompartment) => {
    setResults((prev) => {
      const next = { ...prev };
      for (const item of compartment.items) {
        if (item.checkType === 'header' || item.checkType === 'text') continue;
        const expStatus = getExpirationStatus(item);
        if (expStatus === 'expired') continue;
        const existing = next[item.id];
        const patch: Partial<ItemResult> = { status: 'pass' };
        if (item.checkType === 'quantity') {
          const required = item.requiredQuantity ?? item.expectedQuantity;
          if (required != null) {
            patch.quantityFound = required;
          }
        }
        next[item.id] = {
          status: 'not_checked',
          ...existing,
          ...patch,
        };
      }
      return next;
    });
  }, []);

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
      const confirmed = window.confirm(
        `${uncheckedCount} of ${totalItems} item${uncheckedCount === 1 ? '' : 's'} ha${uncheckedCount === 1 ? 's' : 've'} not been checked. ` +
          `The report will be marked as incomplete.\n\nAre you sure you want to submit?`
      );
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
            is_expired: item.hasExpiration && item.expirationDate ? new Date(item.expirationDate) < new Date() : false,
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
              is_expired:
                item.hasExpiration && item.expirationDate ? new Date(item.expirationDate) < new Date() : false,
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
    const status = getExpirationStatus(item);
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
    const expirationStatus = getExpirationStatus(item);
    const isExpired = expirationStatus === 'expired';

    // Auto-fail expired items
    if (isExpired && currentStatus !== 'fail') {
      queueMicrotask(() => updateResult(item.id, { status: 'fail' }));
    }

    const effectiveStatus = isExpired ? 'fail' : currentStatus;

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
        const prevQty = lastCheckData?.[item.id]?.quantity_found;

        const getQtyColor = () => {
          if (!hasBeenSet) return 'text-theme-text-muted';
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
                  {hasBeenSet ? currentQty : '—'}/{expected} Expected
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
                  Enter the new serial/lot numbers. The template will be automatically updated.
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
              : 'border-theme-surface-border bg-theme-surface'
        }`}
      >
        {/* Item header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {!isQuantity && <TypeIcon className="text-theme-text-muted h-4 w-4 flex-shrink-0" />}
              <span className="text-theme-text-primary text-sm font-medium">{item.name}</span>
              {item.isRequired && <span className="text-[10px] font-medium text-red-500 uppercase">Required</span>}
              {renderExpirationBadge(item)}
            </div>
            {swapOverrides[item.id] && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                <PackageCheck className="h-3 w-3" aria-hidden="true" />
                Swapped in
                {swapOverrides[item.id]?.lotNumber ? ` Lot ${swapOverrides[item.id]?.lotNumber}` : ' fresh stock'}
                {swapOverrides[item.id]?.expirationDate
                  ? ` · exp ${formatDate(swapOverrides[item.id]?.expirationDate, tz)}`
                  : ''}
              </p>
            )}
            {item.description && (
              <p className={`text-theme-text-muted mt-0.5 text-xs ${isQuantity ? '' : 'ml-6'}`}>{item.description}</p>
            )}
            {!isQuantity && (
              <div className="mt-1 ml-6 flex items-center gap-2">
                <span className="text-theme-text-muted text-[10px]">
                  {CHECK_TYPE_LABELS[item.checkType] ?? item.checkType}
                </span>
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
          </button>
          <button
            type="button"
            onClick={() => togglePhotos(item.id)}
            aria-expanded={expandedPhotos.has(item.id)}
            className={`flex min-h-[36px] items-center gap-1 text-xs transition-colors ${
              (result?.photoFiles?.length ?? 0) > 0
                ? 'font-medium text-blue-600'
                : 'text-theme-text-muted hover:text-theme-text-secondary'
            }`}
          >
            <Camera className="h-3 w-3" aria-hidden="true" />
            Photo
            {(result?.photoFiles?.length ?? 0) > 0 && (
              <span className="text-[10px]">({result?.photoFiles?.length})</span>
            )}
          </button>
          {item.inventoryItemId &&
            (getExpirationStatus(item) === 'expired' || getExpirationStatus(item) === 'expiring_soon') && (
              <button
                type="button"
                onClick={() => {
                  void openSwap(item);
                }}
                className="flex min-h-[36px] items-center gap-1 text-xs font-medium text-blue-600 transition-colors hover:text-blue-700"
              >
                <Repeat className="h-3 w-3" aria-hidden="true" />
                Swap
              </button>
            )}
        </div>
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
        {expandedPhotos.has(item.id) && (
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
                  <button
                    type="button"
                    onClick={() => toggleCompartmentCollapse(comp.id)}
                    className={`w-full rounded-xl border-2 p-4 text-left transition-all active:scale-[0.98] ${STATUS_COLORS[status]}`}
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
                      {/* Pass All / Set All to Par */}
                      {!previewMode && checked < checkable.length && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              passAllInCompartment(comp);
                            }}
                            aria-label={
                              hasQuantityItems(comp)
                                ? `Set all items in ${comp.name} to par`
                                : `Mark all items in ${comp.name} as passed`
                            }
                            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs font-medium whitespace-nowrap text-green-700 transition-colors hover:bg-green-500/20 dark:text-green-400"
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
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                All required items must be checked before submitting.
              </p>
            )}
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

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded-lg p-2 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            <h1 className="text-theme-text-primary text-lg font-bold">{template.name}</h1>
          </div>
          <span className="text-theme-text-secondary text-sm font-medium">
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

      {/* Content */}
      {renderFlatView()}

      {/* Lot swap modal — pick a ready replacement to put on the apparatus */}
      {swapTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
          <div className="bg-theme-surface border-theme-surface-border flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-xl sm:max-w-md sm:rounded-2xl">
            <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-theme-text-primary truncate text-sm font-semibold">Swap in fresh stock</h3>
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
            <div className="space-y-2 overflow-auto px-4 py-3">
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
                        {lot.expiration_date ? `Exp ${formatDate(lot.expiration_date, tz)}` : 'No expiration'} ·{' '}
                        {lot.quantity} ready
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
