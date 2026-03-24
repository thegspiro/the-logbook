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
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Clock,
  MessageSquare,
  Loader2,
  ArrowLeft,
  Grid3x3,
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
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
  CheckType,
  LastCheckItemResult,
} from '../../modules/scheduling/types/equipmentCheck';
import { CHECK_TYPE_LABELS } from '../../modules/scheduling/types/equipmentCheck';

// ============================================================================
// Types
// ============================================================================

interface EquipmentCheckFormProps {
  shiftId: string;
  template: EquipmentCheckTemplate;
  onComplete?: () => void;
  onBack?: () => void;
  previewMode?: boolean;
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

function getExpirationStatus(
  item: CheckTemplateItem,
): 'ok' | 'expiring_soon' | 'expired' | null {
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
  results: Record<string, ItemResult>,
): 'complete' | 'has_failures' | 'in_progress' | 'not_started' {
  const checkable = compartment.items.filter((i) => i.checkType !== 'header');
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
  complete:
    'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
  has_failures:
    'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
  in_progress:
    'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  not_started:
    'border-theme-surface-border bg-theme-surface text-theme-text-muted',
} as const;

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
}) => {
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  const [activeCompartment, setActiveCompartment] = useState<number | null>(
    null,
  );
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [expandedPhotos, setExpandedPhotos] = useState<Set<string>>(new Set());
  const [expandedSerialUpdate, setExpandedSerialUpdate] = useState<Set<string>>(
    new Set(),
  );
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

  const compartments = useMemo(() => {
    const raw = template.compartments;
    const childIds = new Set<string>();

    // Identify all compartments that are children of another
    for (const c of raw) {
      if (c.parentCompartmentId) {
        childIds.add(c.id);
      }
    }

    // Build resolved list: for each top-level compartment, append child
    // compartment items with a synthetic header item as a sub-heading
    const resolved: CheckTemplateCompartment[] = [];
    for (const comp of raw) {
      if (childIds.has(comp.id)) continue; // skip children at top level

      // Find children of this compartment, preserving their sort order
      const children = raw.filter((c) => c.parentCompartmentId === comp.id);
      if (children.length === 0) {
        resolved.push(comp);
        continue;
      }

      // Merge: parent items first, then each child as sub-heading + its items
      const mergedItems: CheckTemplateItem[] = [...comp.items];
      for (const child of children) {
        // Inject a synthetic header to label the sub-compartment
        const subHeader: CheckTemplateItem = {
          id: `subheader-${child.id}`,
          compartmentId: comp.id,
          name: child.name,
          sortOrder: mergedItems.length,
          checkType: 'header',
          isRequired: false,
          hasExpiration: false,
          expirationWarningDays: 0,
        };
        if (child.description) subHeader.description = child.description;
        mergedItems.push(subHeader);
        mergedItems.push(...child.items);
      }

      resolved.push({ ...comp, items: mergedItems });
    }

    return resolved;
  }, [template.compartments]);

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
          const record = await schedulingService.submitEquipmentCheck(
            entry.shiftId,
            entry.payload,
          );

          // Upload queued photos
          const photosByItem = new Map<string, Array<{ blob: Blob; fileName: string }>>();
          for (const photo of entry.photos) {
            const arr = photosByItem.get(photo.itemId) ?? [];
            arr.push({ blob: photo.blob, fileName: photo.fileName });
            photosByItem.set(photo.itemId, arr);
          }
          for (const [itemId, photos] of photosByItem) {
            const files = photos.map(
              (p) => new File([p.blob], p.fileName, { type: p.blob.type }),
            );
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
    void getPendingCount().then(setPendingQueueCount).catch(() => {});
  }, [previewMode]);

  // --------------------------------------------------------------------------
  // Progress
  // --------------------------------------------------------------------------

  const allItems = useMemo(
    () => compartments.flatMap((c) => c.items),
    [compartments],
  );

  const checkableItems = useMemo(
    () => allItems.filter((item) => item.checkType !== 'header'),
    [allItems],
  );

  const totalItems = checkableItems.length;
  const checkedItems = checkableItems.filter((item) => {
    const result = results[item.id];
    return result && result.status !== 'not_checked';
  }).length;
  const progressPercent =
    totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  const allRequiredChecked = checkableItems
    .filter((item) => item.isRequired)
    .every((item) => {
      const result = results[item.id];
      return result && result.status !== 'not_checked';
    });

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const updateResult = useCallback(
    (itemId: string, patch: Partial<ItemResult>) => {
      setResults((prev) => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          status: prev[itemId]?.status ?? 'not_checked',
          ...patch,
        },
      }));
    },
    [],
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
    [results, updateResult],
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
    [results, updateResult],
  );

  // --------------------------------------------------------------------------
  // Draft persistence — save progress to localStorage so it survives crashes
  // --------------------------------------------------------------------------

  const draftKey = `equipment-check-draft-${shiftId}-${template.id}`;

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
      localStorage.setItem(
        draftKey,
        JSON.stringify({ results, overallNotes }),
      );
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
                status:
                  required != null
                    ? prev.quantity_found >= required
                      ? 'pass'
                      : 'fail'
                    : 'pass',
                quantityFound: prev.quantity_found,
              };
            } else if (
              (item.checkType === 'level' || item.checkType === 'reading') &&
              prev.level_reading != null
            ) {
              const belowMin =
                item.checkType === 'level' &&
                item.minLevel != null &&
                prev.level_reading < item.minLevel;
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
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, template.apparatusId, previewMode]);

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
  // Pass All — mark all items in a compartment as pass
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Keyboard navigation — auto-advance to next item after marking pass/fail
  // --------------------------------------------------------------------------

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const focusNextItem = useCallback(
    (currentItemId: string) => {
      if (activeCompartment === null) return;
      const comp = compartments[activeCompartment];
      if (!comp) return;
      const currentIdx = comp.items.findIndex((i) => i.id === currentItemId);
      if (currentIdx === -1 || currentIdx >= comp.items.length - 1) return;
      const nextItem = comp.items[currentIdx + 1];
      if (!nextItem) return;
      const nextEl = itemRefs.current[nextItem.id];
      if (nextEl) {
        nextEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const passBtn = nextEl.querySelector<HTMLButtonElement>('[data-action="pass"]');
        passBtn?.focus();
      }
    },
    [activeCompartment, compartments],
  );

  const updateResultAndAdvance = useCallback(
    (itemId: string, patch: Partial<ItemResult>) => {
      updateResult(itemId, patch);
      if (patch.status === 'pass' || patch.status === 'fail') {
        setTimeout(() => focusNextItem(itemId), 150);
      }
    },
    [updateResult, focusNextItem],
  );

  const passAllInCompartment = useCallback(
    (compartment: CheckTemplateCompartment) => {
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
    },
    [],
  );

  const hasQuantityItems = useCallback(
    (compartment: CheckTemplateCompartment) =>
      compartment.items.some((item) => item.checkType === 'quantity'),
    [],
  );

  // --------------------------------------------------------------------------
  // Submit
  // --------------------------------------------------------------------------

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Collect items with photo files for post-submit upload
      const itemsWithPhotos: { itemId: string; files: File[] }[] = [];

      const items: CheckItemResultSubmit[] = [];
      for (const compartment of compartments) {
        for (const item of compartment.items) {
          if (item.checkType === 'header') continue;
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
            compartment_name: compartment.name,
            item_name: item.name,
            check_type: item.checkType,
            status: result?.status || 'not_checked',
            quantity_found: result?.quantityFound,
            required_quantity:
              item.requiredQuantity ?? item.expectedQuantity,
            critical_minimum_quantity:
              item.criticalMinimumQuantity ?? undefined,
            level_reading: result?.levelReading,
            level_unit: item.levelUnit || undefined,
            serial_number: result?.serialNumber || undefined,
            lot_number: result?.lotNumber || undefined,
            serial_found: serialFound,
            lot_found: lotFound,
            is_expired:
              item.hasExpiration && item.expirationDate
                ? new Date(item.expirationDate) < new Date()
                : false,
            expiration_date: item.expirationDate || undefined,
            notes: result?.notes || undefined,
          });
        }
      }

      const payload: ShiftEquipmentCheckCreate = {
        template_id: template.id,
        check_timing: template.checkTiming,
        items,
        notes: overallNotes || undefined,
      };

      // Offline: queue for later sync
      if (!navigator.onLine) {
        await enqueueCheck(shiftId, payload, itemsWithPhotos);
        const count = await getPendingCount();
        setPendingQueueCount(count);
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
        toast.success('Check saved offline — will sync when connected');
        onComplete?.();
        return;
      }

      const checkResult =
        await schedulingService.submitEquipmentCheck(shiftId, payload);

      // Upload photos to check items in parallel after submission
      if (itemsWithPhotos.length > 0 && checkResult.items) {
        await Promise.all(
          itemsWithPhotos.map(({ itemId, files }) => {
            const checkItem = checkResult.items?.find(
              (ci) => ci.templateItemId === itemId,
            );
            if (!checkItem) return Promise.resolve();
            return schedulingService
              .uploadCheckItemPhotos(checkResult.id, checkItem.id, files)
              .catch(() => {
                toast.error(
                  `Failed to upload photos for ${checkItem.itemName}`,
                );
              });
          }),
        );
      }

      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      toast.success('Equipment check submitted successfully');
      onComplete?.();
    } catch {
      // Network error during submit — fall back to offline queue
      try {
        const fallbackItems: CheckItemResultSubmit[] = [];
        const fallbackPhotos: { itemId: string; files: File[] }[] = [];
        for (const compartment of compartments) {
          for (const item of compartment.items) {
            if (item.checkType === 'header') continue;
            const result = results[item.id];
            if (result?.photoFiles && result.photoFiles.length > 0) {
              fallbackPhotos.push({ itemId: item.id, files: result.photoFiles });
            }
            fallbackItems.push({
              template_item_id: item.id,
              compartment_name: compartment.name,
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
              is_expired: item.hasExpiration && item.expirationDate ? new Date(item.expirationDate) < new Date() : false,
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
        await enqueueCheck(shiftId, fallbackPayload, fallbackPhotos);
        const count = await getPendingCount();
        setPendingQueueCount(count);
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
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
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium transition-colors min-h-[48px] ${
            effectiveStatus === 'pass'
              ? 'bg-green-600 text-white'
              : 'border border-theme-surface-border text-theme-text-muted hover:border-green-500 hover:text-green-600'
          } ${isExpired ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <CheckCircle className="h-4 w-4" />
          Pass
        </button>
        <button
          type="button"
          data-action="fail"
          onClick={() => updateResultAndAdvance(item.id, { status: 'fail' })}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium transition-colors min-h-[48px] ${
            effectiveStatus === 'fail'
              ? 'bg-red-600 text-white'
              : 'border border-theme-surface-border text-theme-text-muted hover:border-red-500 hover:text-red-600'
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
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium transition-colors min-h-[48px] ${
                effectiveStatus === 'pass'
                  ? 'bg-green-600 text-white'
                  : 'border border-theme-surface-border text-theme-text-muted hover:border-green-500 hover:text-green-600'
              }`}
            >
              <Eye className="h-4 w-4" />
              Present
            </button>
            <button
              type="button"
              data-action="fail"
              onClick={() => updateResultAndAdvance(item.id, { status: 'fail' })}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-medium transition-colors min-h-[48px] ${
                effectiveStatus === 'fail'
                  ? 'bg-red-600 text-white'
                  : 'border border-theme-surface-border text-theme-text-muted hover:border-red-500 hover:text-red-600'
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
            status:
              required != null
                ? clamped >= required
                  ? 'pass'
                  : 'fail'
                : 'pass',
          });
        };

        return (
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs min-w-0 space-y-0.5">
              {expected != null && (
                <span className={`block ${getQtyColor()}`}>
                  {hasBeenSet ? currentQty : '—'}/{expected} Expected
                </span>
              )}
              {hasBeenSet && isCritical && (
                <span className="block text-[10px] text-red-600 dark:text-red-400 font-semibold">
                  CRITICAL — below minimum ({criticalMin})
                </span>
              )}
              {hasBeenSet && !isAtPar && !isCritical && required != null && (
                <span className="block text-[10px] text-orange-500">
                  Below required ({required})
                </span>
              )}
              {prevQty != null && hasBeenSet && currentQty !== prevQty && (
                <span className="block text-[10px] text-theme-text-muted">
                  Last: {prevQty}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0">
              <button
                type="button"
                onClick={() => setQuantity(currentQty - 1)}
                disabled={isExpired || currentQty <= 0}
                className="flex items-center justify-center w-11 h-11 rounded-l-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-secondary active:bg-theme-surface-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label={`Decrease ${item.name} quantity`}
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                id={`qty-${item.id}`}
                type="number"
                min="0"
                inputMode="numeric"
                className={`w-14 h-11 text-center border-y text-sm font-medium bg-theme-surface focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                  hasBeenSet && isCritical
                    ? 'border-red-600 text-red-600 dark:text-red-400 border-2'
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
                className="flex items-center justify-center w-11 h-11 rounded-r-lg border border-theme-surface-border bg-theme-surface text-theme-text-primary hover:bg-theme-surface-secondary active:bg-theme-surface-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label={`Increase ${item.name} quantity`}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      }

      case 'level': {
        const belowMin =
          item.minLevel != null &&
          result?.levelReading != null &&
          result.levelReading < item.minLevel;

        return (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label htmlFor={`level-${item.id}`} className="text-xs text-theme-text-secondary whitespace-nowrap">
                Reading:
              </label>
              <input
                id={`level-${item.id}`}
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                className={`w-24 rounded-lg border px-3 py-2.5 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-2 min-h-[48px] ${
                  belowMin
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-theme-surface-border focus:ring-blue-500'
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
              <span className="text-xs text-theme-text-muted">
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
              <div className="flex items-center gap-3 text-xs text-theme-text-muted bg-theme-surface-secondary rounded-lg px-3 py-2">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor={`serial-${item.id}`} className="text-xs text-theme-text-secondary mb-1 block">
                  Serial #
                </label>
                <input
                  id={`serial-${item.id}`}
                  type="text"
                  className="w-full rounded-lg border border-theme-surface-border px-3 py-2.5 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                  placeholder={item.serialNumber ?? 'Serial number'}
                  value={result?.serialNumber ?? ''}
                  onChange={(e) =>
                    updateResult(item.id, { serialNumber: e.target.value })
                  }
                />
              </div>
              <div>
                <label htmlFor={`lot-${item.id}`} className="text-xs text-theme-text-secondary mb-1 block">
                  Lot #
                </label>
                <input
                  id={`lot-${item.id}`}
                  type="text"
                  className="w-full rounded-lg border border-theme-surface-border px-3 py-2.5 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                  placeholder={item.lotNumber ?? 'Lot number'}
                  value={result?.lotNumber ?? ''}
                  onChange={(e) =>
                    updateResult(item.id, { lotNumber: e.target.value })
                  }
                />
              </div>
            </div>

            {/* Update serial/lot toggle — for when item has been swapped */}
            <button
              type="button"
              onClick={() => toggleSerialUpdate(item.id)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors min-h-[32px]"
            >
              {showSerialUpdate
                ? 'Cancel update'
                : 'Item swapped? Update serial/lot on template'}
            </button>

            {showSerialUpdate && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Enter the new serial/lot numbers. The template will be
                  automatically updated.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label htmlFor={`new-serial-${item.id}`} className="text-xs text-theme-text-secondary mb-1 block">
                      New Serial #
                    </label>
                    <input
                      id={`new-serial-${item.id}`}
                      type="text"
                      className="w-full rounded-lg border border-blue-500/30 px-3 py-2.5 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
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
                    <label htmlFor={`new-lot-${item.id}`} className="text-xs text-theme-text-secondary mb-1 block">
                      New Lot #
                    </label>
                    <input
                      id={`new-lot-${item.id}`}
                      type="text"
                      className="w-full rounded-lg border border-blue-500/30 px-3 py-2.5 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
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
              <label htmlFor={`reading-${item.id}`} className="text-xs text-theme-text-secondary whitespace-nowrap">
                Reading:
              </label>
              <input
                id={`reading-${item.id}`}
                type="number"
                step="0.01"
                inputMode="decimal"
                className="w-32 rounded-lg border border-theme-surface-border px-3 py-2.5 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
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
        return (
          <div className="space-y-2">
            <textarea
              id={`text-${item.id}`}
              rows={2}
              className="w-full rounded-lg border border-theme-surface-border px-3 py-2.5 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              placeholder="Enter response..."
              value={result?.notes ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                updateResult(item.id, {
                  notes: val || undefined,
                  status: val.trim() ? 'pass' : 'not_checked',
                });
              }}
            />
          </div>
        );

      case 'header':
        return null;

      default:
        return passFailButtons;
    }
  };

  // --------------------------------------------------------------------------
  // Render: Check Item (phone-first, large touch targets)
  // --------------------------------------------------------------------------

  const renderCheckItem = (item: CheckTemplateItem) => {
    if (item.checkType === 'header') {
      return (
        <div key={item.id} className="pt-3 first:pt-0">
          <div className="border-b border-theme-surface-border pb-2">
            <h3 className="text-sm font-bold text-theme-text-primary">
              {item.name}
            </h3>
          </div>
          {item.description && (
            <p className="mt-1 text-[11px] text-theme-text-muted">
              {item.description}
            </p>
          )}
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
        ref={(el) => { itemRefs.current[item.id] = el; }}
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
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {!isQuantity && <TypeIcon className="h-4 w-4 text-theme-text-muted flex-shrink-0" />}
              <span className="text-sm font-medium text-theme-text-primary">
                {item.name}
              </span>
              {item.isRequired && (
                <span className="text-[10px] text-red-500 font-medium uppercase">
                  Required
                </span>
              )}
              {renderExpirationBadge(item)}
            </div>
            {item.description && (
              <p className={`mt-0.5 text-xs text-theme-text-muted ${isQuantity ? '' : 'ml-6'}`}>
                {item.description}
              </p>
            )}
            {!isQuantity && (
              <div className="flex items-center gap-2 mt-1 ml-6">
                <span className="text-[10px] text-theme-text-muted">
                  {CHECK_TYPE_LABELS[item.checkType] ?? item.checkType}
                </span>
              </div>
            )}
            {item.imageUrl && (
              <div className="mt-2">
                <img
                  src={item.imageUrl}
                  alt={`Reference: ${item.name}`}
                  className="rounded-md border border-theme-surface-border max-h-28 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity"
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
            className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors min-h-[36px]"
          >
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            {showNotesField ? 'Hide' : 'Note'}
          </button>
          <button
            type="button"
            onClick={() => togglePhotos(item.id)}
            aria-expanded={expandedPhotos.has(item.id)}
            className={`flex items-center gap-1 text-xs transition-colors min-h-[36px] ${
              (result?.photoFiles?.length ?? 0) > 0
                ? 'text-blue-600 font-medium'
                : 'text-theme-text-muted hover:text-theme-text-secondary'
            }`}
          >
            <Camera className="h-3 w-3" aria-hidden="true" />
            Photo
            {(result?.photoFiles?.length ?? 0) > 0 && (
              <span className="text-[10px]">
                ({result?.photoFiles?.length})
              </span>
            )}
          </button>
        </div>
        {showNotesField && (
          <textarea
            rows={2}
            className="w-full rounded-lg border border-theme-surface-border px-3 py-2 text-sm bg-theme-surface text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <div className="flex gap-2 flex-wrap">
                {result.photoUrls.map((url, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={url}
                      alt={`Photo ${idx + 1}`}
                      className="w-16 h-16 rounded-lg object-cover border border-theme-surface-border"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(item.id, idx)}
                      className="absolute -top-2 -right-2 w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500"
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
                  onClick={() =>
                    photoInputRefs.current[item.id]?.click()
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-theme-surface-border px-3 py-2 text-xs text-theme-text-muted hover:border-blue-500 hover:text-blue-600 transition-colors min-h-[40px]"
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
  // Render: Compartment Overview Grid
  // --------------------------------------------------------------------------

  const renderOverview = () => {
    // Group compartments into sections: each section is optionally preceded by a header
    const sections: { header?: typeof compartments[number]; items: { comp: typeof compartments[number]; idx: number }[] }[] = [];
    let currentSection: typeof sections[number] = { items: [] };

    compartments.forEach((comp, idx) => {
      if (comp.isHeader) {
        // Push the current section if it has items, then start a new one
        if (currentSection.items.length > 0 || currentSection.header) {
          sections.push(currentSection);
        }
        currentSection = { header: comp, items: [] };
      } else {
        currentSection.items.push({ comp, idx });
      }
    });
    if (currentSection.items.length > 0 || currentSection.header) {
      sections.push(currentSection);
    }

    return (
    <div className="space-y-4">
      {sections.map((section, sIdx) => (
        <div key={section.header?.id ?? `section-${sIdx}`} className="space-y-3">
          {section.header && (
            <div className="border-b border-theme-surface-border pb-1 pt-2">
              <h3 className="text-sm font-bold text-theme-text-primary">
                {section.header.name}
              </h3>
              {section.header.description && (
                <p className="text-[10px] text-theme-text-muted mt-0.5">{section.header.description}</p>
              )}
            </div>
          )}
          <div className={`grid grid-cols-1 gap-3 ${previewMode ? '' : 'sm:grid-cols-2'}`}>
            {section.items.map(({ comp, idx }) => {
              const status = getCompartmentStatus(comp, results);
              const checkable = comp.items.filter((i) => i.checkType !== 'header');
              const checked = checkable.filter((i) => {
                const r = results[i.id];
                return r && r.status !== 'not_checked';
              }).length;

              return (
                <button
                  key={comp.id}
                  type="button"
                  onClick={() => setActiveCompartment(idx)}
                  className={`rounded-xl border-2 p-4 text-left transition-all active:scale-[0.98] min-h-[100px] ${STATUS_COLORS[status]}`}
                  aria-label={`${comp.name}, ${checked} of ${checkable.length} checked${status === 'complete' ? ', complete' : status === 'has_failures' ? ', has failures' : ''}`}
                >
                  <p className="font-medium text-sm leading-tight">
                    {comp.name}
                  </p>
                  <p className="text-xs mt-1 opacity-75">
                    {checked}/{checkable.length} checked
                  </p>
                  {status === 'complete' && (
                    <CheckCircle className="h-5 w-5 mt-2" aria-hidden="true" />
                  )}
                  {status === 'has_failures' && (
                    <AlertTriangle className="h-5 w-5 mt-2" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Overall notes + submit (hidden in preview mode) */}
      {!previewMode && (
        <div className="space-y-3 pt-2">
          <div>
            <label htmlFor="overall-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">
              Overall Notes
            </label>
            <textarea
              id="overall-notes"
              rows={3}
              className="w-full rounded-lg border border-theme-surface-border px-3 py-2 text-sm bg-theme-surface text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Any overall notes or observations..."
              value={overallNotes}
              onChange={(e) => setOverallNotes(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !allRequiredChecked}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[52px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isOnline ? 'Submitting...' : 'Saving offline...'}
              </>
            ) : (
              <>
                {isOnline ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <WifiOff className="h-4 w-4" />
                )}
                {isOnline ? 'Submit Report' : 'Save Offline'}
              </>
            )}
          </button>

          {!allRequiredChecked && (
            <p className="text-xs text-center text-theme-text-muted">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              All required items must be checked before submitting.
            </p>
          )}
        </div>
      )}
    </div>
  );
  };

  // --------------------------------------------------------------------------
  // Render: Compartment Detail View
  // --------------------------------------------------------------------------

  const renderCompartmentDetail = (idx: number) => {
    const comp = compartments[idx];
    if (!comp) return null;

    const checkable = comp.items.filter((i) => i.checkType !== 'header');
    const checked = checkable.filter((i) => {
      const r = results[i.id];
      return r && r.status !== 'not_checked';
    }).length;

    return (
      <div className="space-y-4">
        {/* Compartment header with nav */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setActiveCompartment(null)}
            className="flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors min-h-[44px]"
          >
            <Grid3x3 className="h-4 w-4" />
            Overview
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                let prev = idx - 1;
                while (prev >= 0 && compartments[prev]?.isHeader) prev--;
                setActiveCompartment(prev >= 0 ? prev : compartments.length - 1);
              }}
              className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Previous compartment"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            {/* Quick-jump dropdown */}
            <select
              value={idx}
              onChange={(e) => setActiveCompartment(Number(e.target.value))}
              className="rounded-lg border border-theme-surface-border bg-theme-surface px-2 py-1 text-xs text-theme-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[36px] max-w-[100px] sm:max-w-[140px] truncate"
              aria-label="Jump to compartment"
            >
              {compartments.map((c, i) => {
                if (c.isHeader) return null;
                const st = getCompartmentStatus(c, results);
                const prefix = st === 'complete' ? '\u2713 ' : st === 'has_failures' ? '\u2717 ' : '';
                return (
                  <option key={c.id} value={i}>
                    {prefix}{c.name}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={() => {
                let next = idx + 1;
                while (next < compartments.length && compartments[next]?.isHeader) next++;
                setActiveCompartment(next < compartments.length ? next : 0);
              }}
              className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Next compartment"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-theme-text-primary">
              {comp.name}
            </h2>
            {comp.description && (
              <p className="text-sm text-theme-text-muted mt-0.5">
                {comp.description}
              </p>
            )}
            <p className="text-xs text-theme-text-muted mt-1">
              {checked}/{checkable.length} items checked
            </p>
          </div>

          {/* Pass All / Set All to Par button */}
          {!previewMode && checked < checkable.length && (
            <button
              type="button"
              onClick={() => passAllInCompartment(comp)}
              aria-label={hasQuantityItems(comp) ? `Set all items in ${comp.name} to par` : `Mark all items in ${comp.name} as passed`}
              className="flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-500/20 transition-colors whitespace-nowrap min-h-[40px]"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {hasQuantityItems(comp) ? 'Set All to Par' : 'Pass All'}
            </button>
          )}
        </div>

        {/* Items */}
        <div className="space-y-3">
          {comp.items.length === 0 && (
            <p className="text-sm text-theme-text-muted italic py-4 text-center">
              No items in this compartment.
            </p>
          )}
          {comp.items.map((item) => renderCheckItem(item))}
        </div>

        {/* Bottom nav — previous/next compartment with names and status */}
        {(() => {
          let prevIdx = idx - 1;
          while (prevIdx >= 0 && compartments[prevIdx]?.isHeader) prevIdx--;
          let nextIdx = idx + 1;
          while (nextIdx < compartments.length && compartments[nextIdx]?.isHeader) nextIdx++;
          const prevComp = prevIdx >= 0 ? compartments[prevIdx] : undefined;
          const nextComp = nextIdx < compartments.length ? compartments[nextIdx] : undefined;
          const prevStatus = prevComp ? getCompartmentStatus(prevComp, results).replace('_', ' ') : '';
          const nextStatus = nextComp ? getCompartmentStatus(nextComp, results).replace('_', ' ') : '';

          return (
        <div className="flex items-stretch justify-between gap-3 pt-4 border-t border-theme-surface-border">
          <div className="flex-1 min-w-0">
            {prevComp ? (
              <button
                type="button"
                onClick={() => setActiveCompartment(prevIdx)}
                className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-theme-surface-secondary transition-colors min-h-[56px]"
              >
                <span className="text-[10px] uppercase tracking-wide text-theme-text-muted">Previous compartment</span>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400 truncate">
                  {prevComp.name}
                </p>
                <span className="text-[10px] text-theme-text-muted">
                  ({prevStatus})
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveCompartment(null)}
                className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-theme-surface-secondary transition-colors min-h-[56px]"
              >
                <span className="text-[10px] uppercase tracking-wide text-theme-text-muted">Back to</span>
                <p className="text-sm font-medium text-theme-text-muted">Overview</p>
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0 text-right">
            {nextComp ? (
              <button
                type="button"
                onClick={() => setActiveCompartment(nextIdx)}
                className="w-full text-right rounded-lg px-3 py-2.5 hover:bg-theme-surface-secondary transition-colors min-h-[56px]"
              >
                <span className="text-[10px] uppercase tracking-wide text-theme-text-muted">Next compartment</span>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400 truncate">
                  {nextComp.name}
                </p>
                <span className="text-[10px] text-theme-text-muted">
                  ({nextStatus})
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveCompartment(null)}
                className="w-full text-right rounded-lg px-3 py-2.5 bg-blue-600 hover:bg-blue-700 transition-colors min-h-[56px]"
              >
                <span className="text-[10px] uppercase tracking-wide text-white/70">All done</span>
                <p className="text-sm font-medium text-white flex items-center justify-end gap-1">
                  <CheckCircle className="h-4 w-4" />
                  Review & Submit
                </p>
              </button>
            )}
          </div>
        </div>
          );
        })()}
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // Main Render
  // --------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-12 px-3">
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
              <RefreshCw className="h-4 w-4 animate-spin flex-shrink-0" />
            ) : (
              <Clock className="h-4 w-4 flex-shrink-0" />
            )}
            {syncStatus === 'syncing'
              ? 'Syncing queued checks…'
              : `${pendingQueueCount} check(s) waiting to sync`}
          </span>
          {isOnline && syncStatus !== 'syncing' && (
            <button
              type="button"
              onClick={() => void syncPendingChecks()}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
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
            {onBack && activeCompartment === null && (
              <button
                type="button"
                onClick={onBack}
                className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            <h1 className="text-lg font-bold text-theme-text-primary">
              {template.name}
            </h1>
          </div>
          <span className="text-sm font-medium text-theme-text-secondary">
            {checkedItems}/{totalItems}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-theme-surface-border rounded-full h-2.5 overflow-hidden" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`${checkedItems} of ${totalItems} items checked`}>
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              progressPercent === 100 ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Content */}
      {activeCompartment !== null
        ? renderCompartmentDetail(activeCompartment)
        : renderOverview()}
    </div>
  );
};

export { EquipmentCheckForm };
export default EquipmentCheckForm;
