/**
 * LotsAboardPanel
 *
 * The lots physically on the truck for one checklist position, each with its
 * own expiration, and an editor for correcting one.
 *
 * A position that carries three boxes carries three dates. Showing a single
 * date — the position's own column — cannot describe that, and a crew reading
 * dates off boxes in a drug bag has no way to tell whether the application
 * agrees with what is in their hands. That reconciliation is the whole point:
 * when a medication is changed out, the new date has to reach the record in
 * the same act, or the application confidently asserts an expiration for a
 * unit that is no longer in the bag.
 *
 * Listed soonest-first, which is the order to draw from and the order a
 * reported use comes off.
 */

import React, { useState } from 'react';
import { AlertTriangle, Check, Clock, Loader2, Pencil, X } from 'lucide-react';
import type { DeployedLot } from '../types/equipmentCheck';
import { formatCalendarDate } from '@/utils/dateFormatting';

interface LotsAboardPanelProps {
  lots: DeployedLot[];
  /** Absent for a read-only view (a preview, or a member without the action). */
  onSave?: (lotId: string, changes: { quantity: number; lotNumber: string; expirationDate: string }) => Promise<void>;
  onRemove?: (lotId: string) => Promise<void>;
  busy?: boolean;
  /** Shown above the list; omitted where the surrounding screen already says it. */
  heading?: string;
}

interface DraftState {
  lotNumber: string;
  expirationDate: string;
  quantity: string;
}

const LotsAboardPanel: React.FC<LotsAboardPanelProps> = ({ lots, onSave, onRemove, busy = false, heading }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>({ lotNumber: '', expirationDate: '', quantity: '1' });
  const [saving, setSaving] = useState(false);

  const startEdit = (lot: DeployedLot) => {
    setEditingId(lot.id);
    setDraft({
      lotNumber: lot.lotNumber ?? '',
      // Date inputs need a bare YYYY-MM-DD; a stored value may carry a time.
      expirationDate: lot.expirationDate ? lot.expirationDate.slice(0, 10) : '',
      quantity: String(lot.quantity),
    });
  };

  const commit = async () => {
    if (!editingId || !onSave) return;
    setSaving(true);
    try {
      await onSave(editingId, {
        quantity: Math.max(0, Number(draft.quantity) || 0),
        lotNumber: draft.lotNumber,
        expirationDate: draft.expirationDate,
      });
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  if (lots.length === 0) {
    return <p className="text-theme-text-muted py-4 text-center text-sm">Nothing recorded aboard for this item.</p>;
  }

  return (
    <div className="space-y-2">
      {heading && <p className="text-theme-text-muted text-xs">{heading}</p>}
      {lots.map((lot) => {
        const editing = editingId === lot.id;
        return (
          <div
            key={lot.id}
            className={`rounded-lg border p-3 ${
              lot.isExpired ? 'border-red-500/40 bg-red-500/5' : 'border-theme-surface-border'
            }`}
          >
            {editing ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label htmlFor={`lot-no-${lot.id}`} className="text-theme-text-secondary mb-1 block text-xs">
                      Lot #
                    </label>
                    <input
                      id={`lot-no-${lot.id}`}
                      type="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="form-input"
                      value={draft.lotNumber}
                      onChange={(e) => setDraft((d) => ({ ...d, lotNumber: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor={`lot-exp-${lot.id}`} className="text-theme-text-secondary mb-1 block text-xs">
                      Expiration
                    </label>
                    <input
                      id={`lot-exp-${lot.id}`}
                      type="date"
                      className="form-input"
                      value={draft.expirationDate}
                      onChange={(e) => setDraft((d) => ({ ...d, expirationDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor={`lot-qty-${lot.id}`} className="text-theme-text-secondary mb-1 block text-xs">
                      Quantity
                    </label>
                    <input
                      id={`lot-qty-${lot.id}`}
                      type="number"
                      min="0"
                      className="form-input"
                      value={draft.quantity}
                      onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void commit()}
                    className="btn-primary btn-sm inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setEditingId(null)}
                    className="btn-secondary btn-sm inline-flex items-center gap-1"
                  >
                    <X className="h-3.5 w-3.5" /> Cancel
                  </button>
                  <span className="text-theme-text-muted text-[11px]">Quantity 0 takes it off the truck.</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-theme-text-primary truncate text-sm font-medium">
                    {lot.lotNumber || 'No lot #'}
                    <span className="text-theme-text-muted ml-2 font-normal">&times;{lot.quantity}</span>
                  </p>
                  <p
                    className={`flex items-center gap-1 text-xs ${
                      lot.isExpired ? 'font-medium text-red-600 dark:text-red-400' : 'text-theme-text-muted'
                    }`}
                  >
                    {lot.isExpired ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {lot.expirationDate
                      ? `${lot.isExpired ? 'Expired' : 'Expires'} ${formatCalendarDate(lot.expirationDate, { year: 'numeric', month: 'numeric', day: 'numeric' })}`
                      : 'No expiration recorded'}
                  </p>
                </div>
                {onSave && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startEdit(lot)}
                      className="mobile-touch-target flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Correct
                    </button>
                    {onRemove && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onRemove(lot.id)}
                        className="mobile-touch-target text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default LotsAboardPanel;
