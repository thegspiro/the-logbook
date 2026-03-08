/**
 * Equipment Check Form
 *
 * Form component for completing equipment check forms during a shift.
 * Displays a template's compartments and items with pass/fail controls,
 * quantity inputs, expiration badges, and notes fields.
 */

import React, { useState, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  Image as ImageIcon,
  History,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type {
  EquipmentCheckTemplate,
  CheckTemplateCompartment,
  CheckTemplateItem,
  CheckItemResultSubmit,
  ShiftEquipmentCheckCreate,
} from '../../modules/scheduling/types/equipmentCheck';

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
  quantityFound?: number;
  notes?: string;
}

// ============================================================================
// Constants
// ============================================================================

const inputClass =
  'w-full rounded-md border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:border-theme-focus-ring focus:outline-none focus:ring-1 focus:ring-theme-focus-ring';

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

function getAllItems(template: EquipmentCheckTemplate): CheckTemplateItem[] {
  const items: CheckTemplateItem[] = [];
  for (const compartment of template.compartments) {
    for (const item of compartment.items) {
      items.push(item);
    }
  }
  return items;
}

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
  const [expandedCompartments, setExpandedCompartments] = useState<Set<string>>(
    () => new Set(template.compartments.map((c) => c.id)),
  );
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [overallNotes, setOverallNotes] = useState('');

  // --------------------------------------------------------------------------
  // Progress
  // --------------------------------------------------------------------------

  const allItems = getAllItems(template);
  const totalItems = allItems.length;
  const checkedItems = allItems.filter((item) => {
    const result = results[item.id];
    return result && result.status !== 'not_checked';
  }).length;
  const progressPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  const allRequiredChecked = allItems
    .filter((item) => item.isRequired)
    .every((item) => {
      const result = results[item.id];
      return result && result.status !== 'not_checked';
    });

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const setItemStatus = useCallback(
    (itemId: string, status: 'pass' | 'fail') => {
      setResults((prev) => {
        const existing = prev[itemId];
        const updated: Record<string, ItemResult> = { ...prev };
        updated[itemId] = {
          ...existing,
          status,
        };
        return updated;
      });
    },
    [],
  );

  const setItemQuantity = useCallback((itemId: string, quantity: number) => {
    setResults((prev) => {
      const existing = prev[itemId];
      const updated: Record<string, ItemResult> = { ...prev };
      updated[itemId] = {
        ...existing,
        status: existing?.status || 'not_checked',
        quantityFound: quantity,
      };
      return updated;
    });
  }, []);

  const setItemNotes = useCallback((itemId: string, notes: string) => {
    setResults((prev) => {
      const existing = prev[itemId];
      const updated: Record<string, ItemResult> = { ...prev };
      updated[itemId] = {
        ...existing,
        status: existing?.status || 'not_checked',
        notes,
      };
      return updated;
    });
  }, []);

  const toggleCompartment = useCallback((compartmentId: string) => {
    setExpandedCompartments((prev) => {
      const next = new Set(prev);
      if (next.has(compartmentId)) {
        next.delete(compartmentId);
      } else {
        next.add(compartmentId);
      }
      return next;
    });
  }, []);

  const toggleNotes = useCallback((itemId: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
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
      for (const compartment of template.compartments) {
        for (const item of compartment.items) {
          const result = results[item.id];
          items.push({
            template_item_id: item.id,
            compartment_name: compartment.name,
            item_name: item.name,
            status: result?.status || 'not_checked',
            quantity_found: result?.quantityFound,
            required_quantity: item.requiredQuantity,
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
          Expiring Soon
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle className="h-3 w-3" />
        OK
      </span>
    );
  };

  // --------------------------------------------------------------------------
  // Render: Check Item
  // --------------------------------------------------------------------------

  const renderCheckItem = (item: CheckTemplateItem) => {
    const result = results[item.id];
    const currentStatus = result?.status || 'not_checked';
    const expirationStatus = getExpirationStatus(item);
    const isExpired = expirationStatus === 'expired';
    const showNotesField = expandedNotes.has(item.id);

    // Auto-fail expired items
    const effectiveStatus = isExpired ? 'fail' : currentStatus;
    if (isExpired && currentStatus !== 'fail') {
      // Set fail status for expired items on first render encounter
      // Using a microtask to avoid setState during render
      queueMicrotask(() => setItemStatus(item.id, 'fail'));
    }

    const quantityBelowRequired =
      item.checkType === 'quantity' &&
      item.requiredQuantity != null &&
      result?.quantityFound != null &&
      result.quantityFound < item.requiredQuantity;

    return (
      <div
        key={item.id}
        className="rounded-md border border-theme-surface-border bg-theme-surface p-3 space-y-2"
      >
        {/* Item header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-theme-text-primary">
                {item.name}
              </span>
              {item.isRequired && (
                <span className="text-xs text-red-500 font-medium">Required</span>
              )}
              {renderExpirationBadge(item)}
              {item.imageUrl && (
                <ImageIcon className="h-3.5 w-3.5 text-theme-text-muted" />
              )}
            </div>
            {item.description && (
              <p className="mt-0.5 text-xs text-theme-text-muted">{item.description}</p>
            )}
          </div>

          {/* Pass / Fail buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setItemStatus(item.id, 'pass')}
              disabled={isExpired}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                effectiveStatus === 'pass'
                  ? 'bg-green-600 text-white'
                  : 'border border-theme-surface-border text-theme-text-muted hover:border-green-500 hover:text-green-600'
              } ${isExpired ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Pass
            </button>
            <button
              type="button"
              onClick={() => setItemStatus(item.id, 'fail')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                effectiveStatus === 'fail'
                  ? 'bg-red-600 text-white'
                  : 'border border-theme-surface-border text-theme-text-muted hover:border-red-500 hover:text-red-600'
              }`}
            >
              <XCircle className="h-3.5 w-3.5" />
              Fail
            </button>
          </div>
        </div>

        {/* Quantity input */}
        {item.checkType === 'quantity' && (
          <div className="flex items-center gap-3">
            <label className="text-xs text-theme-text-secondary whitespace-nowrap">
              Qty Found:
            </label>
            <input
              type="number"
              min="0"
              className={`w-24 rounded-md border px-2 py-1 text-sm text-theme-text-primary bg-theme-surface focus:outline-none focus:ring-1 focus:ring-theme-focus-ring ${
                quantityBelowRequired
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                  : 'border-theme-surface-border focus:border-theme-focus-ring'
              }`}
              value={result?.quantityFound ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setItemQuantity(item.id, val ? Number(val) : 0);
              }}
            />
            {item.requiredQuantity != null && (
              <span
                className={`text-xs ${
                  quantityBelowRequired
                    ? 'text-red-500 font-medium'
                    : 'text-theme-text-muted'
                }`}
              >
                / {item.requiredQuantity} required
              </span>
            )}
          </div>
        )}

        {/* Notes toggle + field */}
        <div>
          <button
            type="button"
            onClick={() => toggleNotes(item.id)}
            className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors"
          >
            <History className="h-3 w-3" />
            {showNotesField ? 'Hide notes' : 'Add notes'}
          </button>
          {showNotesField && (
            <textarea
              rows={2}
              className={`${inputClass} mt-1`}
              placeholder="Notes for this item..."
              value={result?.notes ?? ''}
              onChange={(e) => setItemNotes(item.id, e.target.value)}
            />
          )}
        </div>
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // Render: Compartment Section
  // --------------------------------------------------------------------------

  const renderCompartment = (compartment: CheckTemplateCompartment) => {
    const isExpanded = expandedCompartments.has(compartment.id);
    const compartmentChecked = compartment.items.filter((item) => {
      const result = results[item.id];
      return result && result.status !== 'not_checked';
    }).length;

    return (
      <div
        key={compartment.id}
        className="rounded-lg border border-theme-surface-border overflow-hidden"
      >
        {/* Compartment header */}
        <button
          type="button"
          onClick={() => toggleCompartment(compartment.id)}
          className="flex w-full items-center justify-between px-4 py-3 bg-theme-surface hover:bg-theme-surface/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-theme-text-muted" />
            ) : (
              <ChevronDown className="h-4 w-4 text-theme-text-muted" />
            )}
            <span className="font-medium text-theme-text-primary">
              {compartment.name}
            </span>
            <span className="text-xs text-theme-text-muted">
              ({compartmentChecked}/{compartment.items.length})
            </span>
          </div>
          {compartmentChecked === compartment.items.length &&
            compartment.items.length > 0 && (
              <CheckCircle className="h-4 w-4 text-green-500" />
            )}
        </button>

        {/* Compartment items */}
        {isExpanded && (
          <div className="border-t border-theme-surface-border px-4 py-3 space-y-3">
            {compartment.items.length === 0 && (
              <p className="text-sm text-theme-text-muted italic py-2">
                No items in this compartment.
              </p>
            )}
            {compartment.items.map((item) =>
              renderCheckItem(item),
            )}
          </div>
        )}
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // Render: Main
  // --------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="p-2 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface transition-colors"
                title="Go back"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold text-theme-text-primary">
                {template.name}
              </h1>
              {template.description && (
                <p className="text-sm text-theme-text-muted mt-0.5">
                  {template.description}
                </p>
              )}
            </div>
          </div>
          <span className="text-sm text-theme-text-secondary">
            Completed {checkedItems}/{totalItems}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-theme-surface-border rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              progressPercent === 100 ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Compartments */}
      <div className="space-y-4">
        {template.compartments.map((compartment) =>
          renderCompartment(compartment),
        )}
      </div>

      {/* Footer */}
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-theme-text-secondary mb-1">
            Overall Notes
          </label>
          <textarea
            rows={3}
            className={inputClass}
            placeholder="Any overall notes or observations for this check..."
            value={overallNotes}
            onChange={(e) => setOverallNotes(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !allRequiredChecked}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
};

export { EquipmentCheckForm };
export default EquipmentCheckForm;
