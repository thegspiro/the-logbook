/**
 * Return Items Modal
 *
 * Shows all items currently held by a member (permanent assignments,
 * active checkouts, and pool issuances) in a selectable list.
 * The quartermaster picks which items to return, sets the return
 * condition, and confirms — no barcode scanning required.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from './Modal';
import {
  Package,
  Check,
  AlertTriangle,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { RETURN_CONDITION_OPTIONS } from '../constants/enums';
import {
  inventoryService,
  type UserInventoryResponse,
  type UserInventoryItem,
  type UserCheckoutItem,
  type UserIssuedItem,
} from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import toast from 'react-hot-toast';

// ── Types ──────────────────────────────────────────────────────────

type HeldItemKind = 'assignment' | 'checkout' | 'issuance';

interface HeldItem {
  kind: HeldItemKind;
  /** The record ID: assignment_id, checkout_id, or issuance_id */
  recordId: string;
  itemId: string;
  itemName: string;
  detail: string;
  /** For pool issuances: how many units were issued */
  quantityIssued?: number;
}

interface ReturnSelection {
  returnCondition: string;
  /** For pool issuances: how many to return (defaults to full qty) */
  quantityReturning: number;
}

interface ReturnResult {
  itemName: string;
  success: boolean;
  error?: string;
}

interface ReturnItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  memberName: string;
  onComplete?: () => void;
}

// ── Condition options (shared from constants/enums) ──────────────────

const CONDITION_OPTIONS = RETURN_CONDITION_OPTIONS;

// ── Component ──────────────────────────────────────────────────────

export const ReturnItemsModal: React.FC<ReturnItemsModalProps> = ({
  isOpen,
  onClose,
  userId,
  memberName,
  onComplete,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heldItems, setHeldItems] = useState<HeldItem[]>([]);

  // Map of recordId → selection state (only selected items appear here)
  const [selections, setSelections] = useState<Record<string, ReturnSelection>>({});
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ReturnResult[] | null>(null);

  // ── Load member inventory ─────────────────────────────────────

  const loadInventory = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    try {
      const data: UserInventoryResponse = await inventoryService.getUserInventory(userId);

      const items: HeldItem[] = [];

      // Permanent assignments
      data.permanent_assignments.forEach((a: UserInventoryItem) => {
        const details: string[] = [];
        if (a.serial_number) details.push(`SN: ${a.serial_number}`);
        if (a.asset_tag) details.push(`AT: ${a.asset_tag}`);
        details.push(`Condition: ${a.condition}`);
        items.push({
          kind: 'assignment',
          recordId: a.assignment_id,
          itemId: a.item_id,
          itemName: a.item_name,
          detail: details.join(' · '),
        });
      });

      // Active checkouts
      data.active_checkouts.forEach((c: UserCheckoutItem) => {
        const details: string[] = [];
        details.push(`Checked out: ${new Date(c.checked_out_at).toLocaleDateString()}`);
        if (c.is_overdue) details.push('OVERDUE');
        items.push({
          kind: 'checkout',
          recordId: c.checkout_id,
          itemId: c.item_id,
          itemName: c.item_name,
          detail: details.join(' · '),
        });
      });

      // Pool issuances
      data.issued_items.forEach((i: UserIssuedItem) => {
        const details: string[] = [];
        details.push(`Qty: ${i.quantity_issued}`);
        if (i.size) details.push(`Size: ${i.size}`);
        details.push(`Issued: ${new Date(i.issued_at).toLocaleDateString()}`);
        items.push({
          kind: 'issuance',
          recordId: i.issuance_id,
          itemId: i.item_id,
          itemName: i.item_name,
          detail: details.join(' · '),
          quantityIssued: i.quantity_issued,
        });
      });

      setHeldItems(items);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load member inventory'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (isOpen) {
      loadInventory();
      setSelections({});
      setResults(null);
    }
  }, [isOpen, loadInventory]);

  // ── Selection management ─────────────────────────────────────

  const toggleSelection = (item: HeldItem) => {
    setSelections((prev) => {
      const next = { ...prev };
      if (next[item.recordId]) {
        delete next[item.recordId];
      } else {
        next[item.recordId] = {
          returnCondition: 'good',
          quantityReturning: item.quantityIssued ?? 1,
        };
      }
      return next;
    });
  };

  const updateCondition = (recordId: string, condition: string) => {
    setSelections((prev) => ({
      ...prev,
      [recordId]: { ...prev[recordId], returnCondition: condition },
    }));
  };

  const updateQuantity = (recordId: string, qty: number) => {
    setSelections((prev) => ({
      ...prev,
      [recordId]: { ...prev[recordId], quantityReturning: qty },
    }));
  };

  const selectAll = () => {
    const next: Record<string, ReturnSelection> = {};
    heldItems.forEach((item) => {
      next[item.recordId] = {
        returnCondition: 'good',
        quantityReturning: item.quantityIssued ?? 1,
      };
    });
    setSelections(next);
  };

  const deselectAll = () => {
    setSelections({});
  };

  const selectedCount = Object.keys(selections).length;

  // ── Submit returns ────────────────────────────────────────────

  const handleSubmit = async () => {
    if (selectedCount === 0) return;
    setSubmitting(true);

    const returnResults: ReturnResult[] = [];

    for (const item of heldItems) {
      const sel = selections[item.recordId];
      if (!sel) continue;

      try {
        if (item.kind === 'assignment') {
          await inventoryService.unassignItem(item.itemId, {
            return_condition: sel.returnCondition,
          });
        } else if (item.kind === 'checkout') {
          await inventoryService.checkInItem(
            item.recordId,
            sel.returnCondition,
          );
        } else if (item.kind === 'issuance') {
          await inventoryService.returnToPool(item.recordId, {
            return_condition: sel.returnCondition,
            quantity_returned: sel.quantityReturning,
          });
        }

        returnResults.push({ itemName: item.itemName, success: true });
      } catch (err: unknown) {
        returnResults.push({
          itemName: item.itemName,
          success: false,
          error: getErrorMessage(err, 'Return failed'),
        });
      }
    }

    setResults(returnResults);
    setSubmitting(false);

    const successCount = returnResults.filter((r) => r.success).length;
    if (successCount > 0) {
      toast.success(`Returned ${successCount} item${successCount !== 1 ? 's' : ''} successfully`);
      onComplete?.();
    }
  };

  // ── Render ────────────────────────────────────────────────────

  const showResults = results !== null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Return Items" size="lg" closeOnClickOutside={false}>
      <div className="space-y-4">
        {/* Member info */}
        <div className="bg-theme-surface-secondary rounded-lg p-3 flex items-center gap-3">
          <RotateCcw className="h-5 w-5 text-theme-text-muted" />
          <div>
            <span className="text-sm text-theme-text-muted">Returning from:</span>
            <span className="ml-2 font-medium text-theme-text-primary">{memberName}</span>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted mr-2" />
            <span className="text-sm text-theme-text-muted">Loading inventory...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Results view */}
        {showResults ? (
          <div className="space-y-3">
            {/* Summary counts */}
            {(() => {
              const successCount = results.filter((r) => r.success).length;
              const failCount = results.length - successCount;
              return (
                <div className="flex items-center gap-3">
                  <h4 className="font-medium text-theme-text-primary">Results</h4>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30">
                    {successCount} returned
                  </span>
                  {failCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30">
                      {failCount} failed
                    </span>
                  )}
                </div>
              );
            })()}
            {/* Failed items first, then successes */}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {[...results].sort((a, b) => Number(a.success) - Number(b.success)).map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    r.success
                      ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                      : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {r.success ? (
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-theme-text-primary">{r.itemName}</p>
                      {!r.success && (
                        <p className="text-xs text-red-600 dark:text-red-400 font-medium">{r.error}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs ${r.success ? 'text-theme-text-muted' : 'text-red-600 dark:text-red-400 font-medium'}`}>
                    {r.success ? 'Returned' : 'Failed'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : !loading && (
          <>
            {/* Empty state */}
            {heldItems.length === 0 ? (
              <div className="text-center py-8">
                <Package className="w-10 h-10 text-theme-text-muted mx-auto mb-2" />
                <p className="text-sm text-theme-text-muted">
                  This member has no items to return.
                </p>
              </div>
            ) : (
              <>
                {/* Select all / deselect all */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-theme-text-secondary">
                    {selectedCount} of {heldItems.length} selected
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={selectAll}
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                    >
                      Select All
                    </button>
                    {selectedCount > 0 && (
                      <button
                        onClick={deselectAll}
                        className="text-xs text-theme-text-muted hover:text-theme-text-primary font-medium"
                      >
                        Deselect All
                      </button>
                    )}
                  </div>
                </div>

                {/* Item list */}
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {heldItems.map((item) => {
                    const isSelected = !!selections[item.recordId];
                    const sel = selections[item.recordId];
                    const kindLabel =
                      item.kind === 'assignment' ? 'Assigned' :
                      item.kind === 'checkout' ? 'Checked Out' :
                      'Issued (Pool)';
                    const kindColor =
                      item.kind === 'assignment' ? 'text-blue-700 dark:text-blue-400' :
                      item.kind === 'checkout' ? 'text-yellow-700 dark:text-yellow-400' :
                      'text-purple-700 dark:text-purple-400';

                    return (
                      <div
                        key={item.recordId}
                        className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10'
                            : 'border-theme-border bg-theme-surface hover:bg-theme-surface-secondary'
                        }`}
                        onClick={() => toggleSelection(item)}
                      >
                        <div className="flex items-start gap-3">
                          {/* Checkbox */}
                          <div className="pt-0.5">
                            <div
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                isSelected
                                  ? 'bg-emerald-600 border-emerald-600'
                                  : 'border-theme-border bg-theme-surface'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                          </div>

                          {/* Item info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-theme-text-primary truncate">
                                {item.itemName}
                              </p>
                              <span className={`text-xs font-medium ${kindColor}`}>
                                {kindLabel}
                              </span>
                            </div>
                            <p className="text-xs text-theme-text-muted mt-0.5">{item.detail}</p>
                          </div>
                        </div>

                        {/* Return options (only when selected) */}
                        {isSelected && sel && (
                          <div
                            className="mt-3 pt-3 border-t border-theme-border flex flex-wrap items-center gap-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Condition */}
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-theme-text-muted">Condition:</label>
                              <select
                                value={sel.returnCondition}
                                onChange={(e) => updateCondition(item.recordId, e.target.value)}
                                className="px-2 py-1 border border-theme-border rounded text-xs bg-theme-surface text-theme-text-primary"
                              >
                                {CONDITION_OPTIONS.map((c) => (
                                  <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                              </select>
                            </div>

                            {/* Quantity (pool items only) */}
                            {item.kind === 'issuance' && item.quantityIssued && item.quantityIssued > 1 && (
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-theme-text-muted">Return qty:</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={item.quantityIssued}
                                  value={sel.quantityReturning}
                                  onChange={(e) =>
                                    updateQuantity(
                                      item.recordId,
                                      Math.min(item.quantityIssued!, Math.max(1, parseInt(e.target.value) || 1)),
                                    )
                                  }
                                  className="w-16 px-2 py-1 border border-theme-border rounded text-xs text-center bg-theme-surface text-theme-text-primary"
                                />
                                <span className="text-xs text-theme-text-muted">
                                  of {item.quantityIssued}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Submit */}
                {selectedCount > 0 && (
                  <div className="flex justify-end gap-3 pt-2 border-t border-theme-border">
                    <button
                      onClick={onClose}
                      className="px-4 py-2 border border-theme-border rounded-lg text-theme-text-primary hover:bg-theme-surface-secondary text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Return {selectedCount} Item{selectedCount !== 1 ? 's' : ''}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
