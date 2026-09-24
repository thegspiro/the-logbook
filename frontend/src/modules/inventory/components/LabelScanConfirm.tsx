/**
 * Confirm a print run label by label, by scanning each one as it comes off.
 *
 * A single "did the labels print?" button can only answer for the whole batch,
 * so a roll that jammed halfway leaves the member choosing between marking
 * items that have no label and marking none. Scanning answers per item — and
 * proves the label actually scans, which is the point of having one.
 *
 * Codes arrive through ScanCodeField — the camera or a handheld scanner, with
 * the camera's repeat reads already filtered out — so this component only
 * decides what a code means for the batch.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventoryItem } from '../types';
import { formatNumber } from '../../../utils/dateFormatting';
import { ScanCodeField } from './ScanCodeField';

type ScanOutcome =
  | { kind: 'matched'; name: string }
  | { kind: 'repeat'; name: string }
  | { kind: 'foreign'; code: string }
  | { kind: 'error'; message: string };

interface LabelScanConfirmProps {
  items: InventoryItem[];
  /** The value each item's label encodes, as the print page renders it. */
  labelValueOf: (item: InventoryItem) => string | null;
  /** Record the scanned items; resolves once saved, rejects to keep the panel open. */
  onConfirm: (itemIds: string[]) => Promise<void>;
  onCancel: () => void;
}

export const LabelScanConfirm: React.FC<LabelScanConfirmProps> = ({ items, labelValueOf, onConfirm, onCancel }) => {
  const [scanned, setScanned] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [saving, setSaving] = useState(false);
  // Mirrors `scanned` so the camera callback, which outlives renders, reads
  // the current set rather than the one it closed over.
  const scannedRef = useRef(scanned);
  scannedRef.current = scanned;

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  // Keyed on the exact encoded value. The label carries the value verbatim, so
  // an exact match is the only one that proves this label belongs to this item.
  const byValue = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of items) {
      const value = labelValueOf(item);
      if (value && !map.has(value)) map.set(value, item);
    }
    return map;
  }, [items, labelValueOf]);

  // True only for a label newly ticked off, so a repeat does not flash success.
  const accept = useCallback((item: InventoryItem): boolean => {
    if (scannedRef.current.has(item.id)) {
      setOutcome({ kind: 'repeat', name: item.name });
      return false;
    }
    scannedRef.current = new Set(scannedRef.current).add(item.id);
    setScanned(scannedRef.current);
    setOutcome({ kind: 'matched', name: item.name });
    return true;
  }, []);

  const handleCode = useCallback(
    async (code: string): Promise<boolean> => {
      const local = byValue.get(code);
      if (local) return accept(local);
      // Not a value this page rendered. The PDF path can assign a barcode as
      // it prints, which the items loaded here predate, so ask the server
      // which item the code belongs to before calling it foreign.
      try {
        const { results } = await inventoryService.lookupByCode(code);
        const match = results.map((r) => byId.get(r.item.id)).find((item) => item !== undefined);
        if (match) return accept(match);
        setOutcome({ kind: 'foreign', code });
      } catch {
        setOutcome({ kind: 'error', message: `Could not look up ${code}` });
      }
      return false;
    },
    [accept, byId, byValue]
  );

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm(Array.from(scanned));
    } catch {
      // The caller reports the failure; staying open keeps every scan.
    } finally {
      setSaving(false);
    }
  };

  const remaining = items.filter((item) => !scanned.has(item.id));

  return (
    <div className="card-secondary mb-4 space-y-3 p-3">
      <p className="text-theme-text-primary text-sm font-medium" aria-live="polite">
        {formatNumber(scanned.size)} of {formatNumber(items.length)} labels scanned
      </p>

      <ScanCodeField
        viewportId="label-confirm-scanner-viewport"
        label="Scan or type a label’s barcode"
        submitLabel="Check"
        onCode={handleCode}
      />

      {outcome && (
        <p
          role="status"
          className={`flex items-center gap-1.5 text-sm ${
            outcome.kind === 'matched'
              ? 'text-emerald-800 dark:text-emerald-300'
              : outcome.kind === 'repeat'
                ? 'text-theme-text-secondary'
                : 'text-red-700 dark:text-red-400'
          }`}
        >
          {outcome.kind === 'matched' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : outcome.kind === 'repeat' ? null : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          {outcome.kind === 'matched' && `${outcome.name} — confirmed`}
          {outcome.kind === 'repeat' && `${outcome.name} was already scanned`}
          {outcome.kind === 'foreign' && `${outcome.code} is not one of the labels in this batch`}
          {outcome.kind === 'error' && outcome.message}
        </p>
      )}

      {remaining.length > 0 && scanned.size > 0 && (
        <details className="text-sm">
          <summary className="text-theme-text-secondary cursor-pointer">
            {formatNumber(remaining.length)} not scanned yet
          </summary>
          <ul className="text-theme-text-muted mt-1 max-h-40 list-disc overflow-y-auto pl-5">
            {remaining.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={scanned.size === 0 || saving}
          className="btn-success btn-sm inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Mark {formatNumber(scanned.size)} scanned {scanned.size === 1 ? 'item' : 'items'} as labelled
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
          Back
        </button>
      </div>
    </div>
  );
};

export default LabelScanConfirm;
