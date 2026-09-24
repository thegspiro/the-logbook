/**
 * Put-away: scan a shelf label, then the items going onto that shelf, and file
 * them there in one step.
 *
 * Both kinds of label arrive through the same ScanCodeField. A code matching a
 * storage-area barcode picks the target shelf; anything else is looked up as
 * an item. The server decides what may move — items a member holds, or whose
 * record says they are gone, come back as skipped with a reason — so this
 * panel only collects the scans and reports what happened.
 */

import React, { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import type { PutAwayResult, StorageAreaResponse } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatNumber } from '../../../utils/dateFormatting';
import { MAX_LABEL_BATCH } from '../utils/labelPrintQuery';
import { ScanCodeField } from './ScanCodeField';

interface QueuedItem {
  id: string;
  name: string;
}

interface PutAwayPanelProps {
  areas: StorageAreaResponse[];
  /** The shelf already in view, if any; a shelf scan replaces it. */
  initialArea: StorageAreaResponse | null;
  pathOf: (area: StorageAreaResponse) => string;
  /** Called after items were filed, so the page can refresh and show the shelf. */
  onFiled: (area: StorageAreaResponse) => void;
  onClose: () => void;
}

export const PutAwayPanel: React.FC<PutAwayPanelProps> = ({ areas, initialArea, pathOf, onFiled, onClose }) => {
  const [target, setTarget] = useState<StorageAreaResponse | null>(initialArea);
  const [queued, setQueued] = useState<QueuedItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PutAwayResult | null>(null);

  const shelfFor = (code: string) => {
    const wanted = code.trim().toUpperCase();
    return areas.find((a) => (a.barcode ?? '').trim().toUpperCase() === wanted);
  };

  const handleCode = async (code: string): Promise<boolean> => {
    setResult(null);
    const shelf = shelfFor(code);
    if (shelf) {
      if (target?.id === shelf.id) {
        setMessage(null);
        return true;
      }
      // Switching shelves with items queued would leave it unclear which
      // shelf they were scanned for; make the member finish or clear first.
      if (queued.length > 0) {
        setMessage(
          `File the ${formatNumber(queued.length)} scanned items first, or clear them, before changing shelf.`
        );
        return false;
      }
      setTarget(shelf);
      setMessage(null);
      return true;
    }
    if (!target) {
      setMessage('Scan the shelf label first, then the items going onto it.');
      return false;
    }
    if (queued.length >= MAX_LABEL_BATCH) {
      setMessage(`File these ${formatNumber(MAX_LABEL_BATCH)} items before scanning more.`);
      return false;
    }
    try {
      const { results } = await inventoryService.lookupByCode(code);
      const item = results[0]?.item;
      if (!item) {
        setMessage(`No item has the barcode ${code}.`);
        return false;
      }
      if (queued.some((q) => q.id === item.id)) {
        setMessage(`${item.name} is already in the list.`);
        return false;
      }
      setQueued((prev) => [...prev, { id: item.id, name: item.name }]);
      setMessage(null);
      return true;
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, `Could not look up ${code}`));
      return false;
    }
  };

  const fileItems = async () => {
    if (!target || queued.length === 0) return;
    setSaving(true);
    try {
      const res = await inventoryService.putAwayItems(
        target.id,
        queued.map((q) => q.id)
      );
      setResult(res);
      setQueued([]);
      if (res.moved.length > 0) {
        toast.success(
          `Filed ${formatNumber(res.moved.length)} ${res.moved.length === 1 ? 'item' : 'items'} on ${target.name}`
        );
        onFiled(target);
      }
    } catch (err: unknown) {
      // Keep the list: a failed save must not cost the member their scans.
      toast.error(getErrorMessage(err, 'Could not file the items'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-secondary space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-theme-text-primary text-sm font-semibold">Put away</h2>
          <p className="text-theme-text-secondary text-sm" aria-live="polite">
            {target ? (
              <>
                Filing onto <span className="font-medium">{pathOf(target)}</span>
                {target.barcode ? <span className="text-theme-text-muted font-mono"> ({target.barcode})</span> : null}
              </>
            ) : (
              'Scan the shelf label first, then each item going onto it.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close put away"
          className="text-theme-text-muted hover:text-theme-text-primary rounded p-2"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ScanCodeField
        viewportId="put-away-scanner-viewport"
        label="Scan or type a shelf or item barcode"
        submitLabel="Add"
        onCode={handleCode}
      />

      {message && (
        <p role="status" className="text-sm text-red-700 dark:text-red-400">
          {message}
        </p>
      )}

      {queued.length > 0 && (
        <ul className="border-theme-surface-border divide-theme-surface-border max-h-60 divide-y overflow-y-auto rounded-lg border">
          {queued.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span className="text-theme-text-primary truncate">{item.name}</span>
              <button
                type="button"
                onClick={() => setQueued((prev) => prev.filter((q) => q.id !== item.id))}
                aria-label={`Remove ${item.name}`}
                className="text-theme-text-muted rounded p-1.5 hover:text-red-700 dark:hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div role="status" className="space-y-1 text-sm">
          <p className="text-theme-text-primary">
            {formatNumber(result.moved.length)} filed
            {result.already_here.length > 0 && `, ${formatNumber(result.already_here.length)} already there`}
            {result.not_found > 0 && `, ${formatNumber(result.not_found)} not found`}.
          </p>
          {result.skipped.length > 0 && (
            <ul className="list-disc pl-5 text-amber-800 dark:text-amber-300">
              {result.skipped.map((s) => (
                <li key={s.item_id}>
                  {s.name}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void fileItems()}
          disabled={!target || queued.length === 0 || saving}
          className="btn-success btn-sm inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {target
            ? `File ${formatNumber(queued.length)} ${queued.length === 1 ? 'item' : 'items'} on ${target.name}`
            : 'File items'}
        </button>
        {queued.length > 0 && (
          <button type="button" onClick={() => setQueued([])} className="btn-secondary btn-sm">
            Clear list
          </button>
        )}
      </div>
    </div>
  );
};

export default PutAwayPanel;
