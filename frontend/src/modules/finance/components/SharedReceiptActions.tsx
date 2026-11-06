/**
 * One receipt across several lines of an expense report (owner decision
 * 2026-11-01): a hotel folio that covers the room, the parking and the
 * meals is uploaded once and used on each.
 *
 * Offers the receipts already on the report's other lines, says which lines
 * a receipt is shared with, and on a draft takes it off this line alone. The
 * server decides who may and when (`POST`/`DELETE …/items/{id}/receipt…`),
 * the same rule as an upload; `canShare` and `canRemove` only keep the page
 * from offering what it would refuse.
 */

import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '@/utils/errorHandling';
import type { ExpenseLineItem } from '../types';

interface SharedReceiptActionsProps {
  line: ExpenseLineItem;
  lines: ExpenseLineItem[];
  /** The caller may attach receipts on this report now. */
  canShare: boolean;
  /** The report is a draft, so a receipt may come off one line. */
  canRemove: boolean;
  onShare: (fromItemId: string) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}

export const SharedReceiptActions: React.FC<SharedReceiptActionsProps> = ({
  line,
  lines,
  canShare,
  canRemove,
  onShare,
  onRemove,
}) => {
  const selectId = useId();
  const [busy, setBusy] = useState(false);
  const sharedWith = line.receiptDocumentId
    ? lines.filter((other) => other.id !== line.id && other.receiptDocumentId === line.receiptDocumentId)
    : [];
  // One entry per receipt, named by the first line that carries it.
  const sources: ExpenseLineItem[] = [];
  for (const other of lines) {
    if (
      other.id !== line.id &&
      other.receiptDocumentId &&
      other.receiptDocumentId !== line.receiptDocumentId &&
      !sources.some((source) => source.receiptDocumentId === other.receiptDocumentId)
    ) {
      sources.push(other);
    }
  }

  const run = async (action: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 space-y-1">
      {sharedWith.length > 0 && (
        <p className="text-theme-text-secondary text-xs">
          Also the receipt for {sharedWith.map((other) => `"${other.description}"`).join(', ')}
        </p>
      )}
      {canShare && sources.length > 0 && (
        <div>
          <label htmlFor={selectId} className="sr-only">
            Use another line&apos;s receipt for {line.description}
          </label>
          <select
            id={selectId}
            className="form-input-sm"
            value=""
            disabled={busy}
            onChange={(e) => {
              const fromItemId = e.target.value;
              if (fromItemId) {
                void run(() => onShare(fromItemId), 'Receipt attached', 'Could not use that receipt');
              }
            }}
          >
            <option value="">Use the receipt from…</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.description}
              </option>
            ))}
          </select>
        </div>
      )}
      {canRemove && line.receiptDocumentId && (
        <button
          type="button"
          disabled={busy}
          className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 text-xs underline"
          aria-label={`Remove the receipt from ${line.description}`}
          onClick={() => void run(onRemove, 'Receipt removed from this line', 'Could not remove the receipt')}
        >
          Remove from this line
        </button>
      )}
    </div>
  );
};
