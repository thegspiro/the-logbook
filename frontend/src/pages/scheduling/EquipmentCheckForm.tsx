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

import React, { useState, useCallback, useMemo } from 'react';
import {
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Clock,
  Image as ImageIcon,
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type {
  EquipmentCheckTemplate,
  CheckTemplateCompartment,
  CheckTemplateItem,
  CheckItemResultSubmit,
  ShiftEquipmentCheckCreate,
  CheckType,
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
}

interface ItemResult {
  status: 'pass' | 'fail' | 'not_checked';
  quantityFound?: number | undefined;
  levelReading?: number | undefined;
  serialNumber?: string | undefined;
  lotNumber?: string | undefined;
  photoUrls?: string[] | undefined;
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
  if (compartment.items.length === 0) return 'complete';

  let checked = 0;
  let failed = 0;
  for (const item of compartment.items) {
    const result = results[item.id];
    if (result && result.status !== 'not_checked') {
      checked++;
      if (result.status === 'fail') failed++;
    }
  }

  if (checked === 0) return 'not_started';
  if (checked === compartment.items.length) {
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
};

// ============================================================================
// Component
// ============================================================================

const EquipmentCheckForm: React.FC<EquipmentCheckFormProps> = ({
  shiftId,
  template,
  onComplete,
  onBack,
}) => {
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  const [activeCompartment, setActiveCompartment] = useState<number | null>(
    null,
  );
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [overallNotes, setOverallNotes] = useState('');

  const compartments = template.compartments;

  // --------------------------------------------------------------------------
  // Progress
  // --------------------------------------------------------------------------

  const allItems = useMemo(
    () => compartments.flatMap((c) => c.items),
    [compartments],
  );

  const totalItems = allItems.length;
  const checkedItems = allItems.filter((item) => {
    const result = results[item.id];
    return result && result.status !== 'not_checked';
  }).length;
  const progressPercent =
    totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  const allRequiredChecked = allItems
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

  // --------------------------------------------------------------------------
  // Submit
  // --------------------------------------------------------------------------

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const items: CheckItemResultSubmit[] = [];
      for (const compartment of compartments) {
        for (const item of compartment.items) {
          const result = results[item.id];
          items.push({
            template_item_id: item.id,
            compartment_name: compartment.name,
            item_name: item.name,
            check_type: item.checkType,
            status: result?.status || 'not_checked',
            quantity_found: result?.quantityFound,
            required_quantity:
              item.requiredQuantity ?? item.expectedQuantity,
            level_reading: result?.levelReading,
            level_unit: item.levelUnit || undefined,
            serial_number: result?.serialNumber || undefined,
            lot_number: result?.lotNumber || undefined,
            photo_urls:
              result?.photoUrls && result.photoUrls.length > 0
                ? result.photoUrls
                : undefined,
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

      await schedulingService.submitEquipmentCheck(shiftId, payload);
      toast.success('Equipment check submitted successfully');
      onComplete?.();
    } catch {
      toast.error('Failed to submit equipment check');
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
          onClick={() => updateResult(item.id, { status: 'pass' })}
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
          onClick={() => updateResult(item.id, { status: 'fail' })}
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
              onClick={() => updateResult(item.id, { status: 'pass' })}
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
              onClick={() => updateResult(item.id, { status: 'fail' })}
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
        const quantityBelowRequired =
          (item.requiredQuantity ?? item.expectedQuantity) != null &&
          result?.quantityFound != null &&
          result.quantityFound <
            (item.requiredQuantity ?? item.expectedQuantity ?? 0);

        return (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label className="text-xs text-theme-text-secondary whitespace-nowrap">
                Qty Found:
              </label>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                className={`w-24 rounded-lg border px-3 py-2.5 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-2 min-h-[48px] ${
                  quantityBelowRequired
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-theme-surface-border focus:ring-blue-500'
                }`}
                value={result?.quantityFound ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const qty = val ? Number(val) : undefined;
                  const required =
                    item.requiredQuantity ?? item.expectedQuantity;
                  updateResult(item.id, {
                    quantityFound: qty,
                    status:
                      qty != null && required != null
                        ? qty >= required
                          ? 'pass'
                          : 'fail'
                        : qty != null
                          ? 'pass'
                          : 'not_checked',
                  });
                }}
              />
              {(item.requiredQuantity ?? item.expectedQuantity) != null && (
                <span
                  className={`text-xs ${quantityBelowRequired ? 'text-red-500 font-medium' : 'text-theme-text-muted'}`}
                >
                  / {item.requiredQuantity ?? item.expectedQuantity} required
                </span>
              )}
            </div>
            {passFailButtons}
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
              <label className="text-xs text-theme-text-secondary whitespace-nowrap">
                Reading:
              </label>
              <input
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

      case 'date_lot':
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-theme-text-secondary mb-1 block">
                  Serial #
                </label>
                <input
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
                <label className="text-xs text-theme-text-secondary mb-1 block">
                  Lot #
                </label>
                <input
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
            {passFailButtons}
          </div>
        );

      case 'reading':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label className="text-xs text-theme-text-secondary whitespace-nowrap">
                Reading:
              </label>
              <input
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

      default:
        return passFailButtons;
    }
  };

  // --------------------------------------------------------------------------
  // Render: Check Item (phone-first, large touch targets)
  // --------------------------------------------------------------------------

  const renderCheckItem = (item: CheckTemplateItem) => {
    const result = results[item.id];
    const effectiveStatus = result?.status ?? 'not_checked';
    const showNotesField = expandedNotes.has(item.id);
    const TypeIcon = CHECK_TYPE_ICONS[item.checkType] ?? CheckCircle;

    return (
      <div
        key={item.id}
        className={`rounded-lg border p-4 space-y-3 transition-colors ${
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
              <TypeIcon className="h-4 w-4 text-theme-text-muted flex-shrink-0" />
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
              <p className="mt-0.5 text-xs text-theme-text-muted ml-6">
                {item.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1 ml-6">
              <span className="text-[10px] text-theme-text-muted">
                {CHECK_TYPE_LABELS[item.checkType] ?? item.checkType}
              </span>
              {item.imageUrl && (
                <ImageIcon className="h-3 w-3 text-theme-text-muted" />
              )}
            </div>
          </div>
        </div>

        {/* Check input area */}
        {renderCheckInput(item)}

        {/* Notes + Photo */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleNotes(item.id)}
            className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors min-h-[36px]"
          >
            <MessageSquare className="h-3 w-3" />
            {showNotesField ? 'Hide' : 'Note'}
          </button>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors min-h-[36px]"
            title="Photo documentation (coming soon)"
            disabled
          >
            <Camera className="h-3 w-3" />
            Photo
          </button>
        </div>
        {showNotesField && (
          <textarea
            rows={2}
            className="w-full rounded-lg border border-theme-surface-border px-3 py-2 text-sm bg-theme-surface text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Notes for this item..."
            value={result?.notes ?? ''}
            onChange={(e) => updateResult(item.id, { notes: e.target.value })}
          />
        )}
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // Render: Compartment Overview Grid
  // --------------------------------------------------------------------------

  const renderOverview = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {compartments.map((comp, idx) => {
          const status = getCompartmentStatus(comp, results);
          const checked = comp.items.filter((i) => {
            const r = results[i.id];
            return r && r.status !== 'not_checked';
          }).length;

          return (
            <button
              key={comp.id}
              type="button"
              onClick={() => setActiveCompartment(idx)}
              className={`rounded-xl border-2 p-4 text-left transition-all active:scale-[0.98] min-h-[100px] ${STATUS_COLORS[status]}`}
            >
              <p className="font-medium text-sm leading-tight">
                {comp.name}
              </p>
              <p className="text-xs mt-1 opacity-75">
                {checked}/{comp.items.length} checked
              </p>
              {status === 'complete' && (
                <CheckCircle className="h-5 w-5 mt-2" />
              )}
              {status === 'has_failures' && (
                <AlertTriangle className="h-5 w-5 mt-2" />
              )}
            </button>
          );
        })}
      </div>

      {/* Overall notes + submit */}
      <div className="space-y-3 pt-2">
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            Overall Notes
          </label>
          <textarea
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
              Submitting...
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
              Submit Equipment Check
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
    </div>
  );

  // --------------------------------------------------------------------------
  // Render: Compartment Detail View
  // --------------------------------------------------------------------------

  const renderCompartmentDetail = (idx: number) => {
    const comp = compartments[idx];
    if (!comp) return null;

    const checked = comp.items.filter((i) => {
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
              onClick={() =>
                setActiveCompartment(
                  idx > 0 ? idx - 1 : compartments.length - 1,
                )
              }
              className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Previous compartment"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-xs text-theme-text-muted px-2">
              {idx + 1}/{compartments.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setActiveCompartment(
                  idx < compartments.length - 1 ? idx + 1 : 0,
                )
              }
              className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Next compartment"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

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
            {checked}/{comp.items.length} items checked
          </p>
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

        {/* Bottom nav */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() =>
              setActiveCompartment(
                idx > 0 ? idx - 1 : null,
              )
            }
            className="flex items-center gap-1 text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors min-h-[44px]"
          >
            <ChevronLeft className="h-4 w-4" />
            {idx > 0
              ? compartments[idx - 1]?.name ?? 'Previous'
              : 'Overview'}
          </button>
          {idx < compartments.length - 1 ? (
            <button
              type="button"
              onClick={() => setActiveCompartment(idx + 1)}
              className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors min-h-[44px]"
            >
              {compartments[idx + 1]?.name ?? 'Next'}
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActiveCompartment(null)}
              className="flex items-center gap-1 text-sm font-medium text-green-600 hover:text-green-700 transition-colors min-h-[44px]"
            >
              <CheckCircle className="h-4 w-4" />
              Review & Submit
            </button>
          )}
        </div>
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // Main Render
  // --------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-12 px-3">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && activeCompartment === null && (
              <button
                type="button"
                onClick={onBack}
                className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors"
                title="Go back"
              >
                <ArrowLeft className="h-5 w-5" />
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
        <div className="w-full bg-theme-surface-border rounded-full h-2.5 overflow-hidden">
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
