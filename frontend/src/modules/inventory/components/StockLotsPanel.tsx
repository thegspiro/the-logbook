/**
 * StockLotsPanel
 *
 * Manages the ready-replacement stock lots for a consumable inventory item.
 * Each lot carries its own lot number, expiration date, and on-hand quantity,
 * so a supply officer can keep fresh units ready to swap onto apparatus during
 * equipment checks. Lots nearing (or past) expiration are highlighted.
 *
 * The panel also lists where the item is currently deployed. Stock on its own
 * does not answer the question a recall or an expiring lot actually raises —
 * which trucks carry this, and what is on each of them right now — and that
 * link was previously only readable from the apparatus side.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, AlertTriangle, Clock, Loader2, PackagePlus, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '@/services/inventoryService';
import { equipmentCheckService } from '../services/equipmentCheckApi';
import type { ItemDeployment } from '@/modules/inventory/types/equipmentCheck';
import type { InventoryLot, InventoryLotCreate } from '@/services/eventServices';
import { getErrorMessage } from '@/utils/errorHandling';
import { formatCalendarDate, getTodayLocalDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '@/hooks/useFieldErrors';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';

import { useConfirm } from '../../../contexts/ConfirmContext';
interface StockLotsPanelProps {
  itemId: string;
  canManage: boolean;
}

/** The add-lot form as typed; quantity is kept as text so a cleared box is not read as 0. */
interface LotForm {
  lot_number: string;
  quantity: string;
  expiration_date: string;
  received_date: string;
  notes: string;
}

function emptyForm(): LotForm {
  return {
    lot_number: '',
    expiration_date: '',
    quantity: '1',
    received_date: '',
    notes: '',
  };
}

type LotField = keyof LotForm;
// Ordered as on screen, so the first refusal takes focus. Limits mirror
// InventoryLotBase (lot_number 100, FreeText 2000).
const LOT_FIELDS: FieldSpecs<LotField> = {
  lot_number: { id: 'stock-lot-number', label: 'Lot Number' },
  quantity: { id: 'stock-lot-quantity', label: 'Quantity' },
  expiration_date: { id: 'stock-lot-expiration', label: 'Expiration Date' },
  received_date: { id: 'stock-lot-received', label: 'Received Date' },
  notes: { id: 'stock-lot-notes', label: 'Notes' },
};
const LOT_LIMITS = { lot_number: 100, notes: 2000 } as const;

const StockLotsPanel: React.FC<StockLotsPanelProps> = ({ itemId, canManage }) => {
  const { confirm } = useConfirm();
  // Still needed for `getTodayLocalDate`: "how many days until this expires" is
  // asked from where the reader is standing. The expiration date itself is not
  // — it is a calendar date, the same day everywhere, and running it through a
  // timezone-converting formatter printed it a day early for any viewer behind
  // UTC. The count and the date beside it then disagreed in one sentence:
  // "Exp 9/3/2026 · 24d left", 24 days after 8/11 being 9/4.
  const tz = useTimezone();
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<LotForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deployments, setDeployments] = useState<ItemDeployment[]>([]);
  const lotErrors = useFieldErrors(LOT_FIELDS);
  const set = (patch: Partial<LotForm>) => {
    setForm((p) => ({ ...p, ...patch }));
    for (const key of Object.keys(patch)) lotErrors.setError(key as LotField, null);
  };
  const closeForm = () => {
    setShowForm(false);
    setForm(emptyForm());
    lotErrors.clear();
  };
  // Cancel asks before throwing a typed lot away (forms review F-6).
  const requestCancel = useDiscardGuard({
    isDirty: showForm && JSON.stringify(form) !== JSON.stringify(emptyForm()),
    onClose: closeForm,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLots(await inventoryService.getItemLots(itemId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load stock lots'));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Loaded separately from the lots: a department without the equipment-check
  // module gets an empty list here, and that must not blank out the stock it
  // came to this tab for.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await equipmentCheckService.getItemDeployments(itemId);
        if (!cancelled) setDeployments(rows);
      } catch {
        if (!cancelled) setDeployments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    // Named on the field rather than in a toast that vanished (forms review
    // F-3). A new lot is not added until every field is fixed.
    const problems: FieldErrors<LotField> = {};
    const quantity = form.quantity.trim();
    if (!quantity || !Number.isInteger(Number(quantity)) || Number(quantity) < 0)
      problems.quantity = 'Enter how many units, a whole number 0 or more.';
    lotErrors.setFormError(null);
    lotErrors.setErrors(problems);
    if (Object.keys(problems).length > 0) {
      lotErrors.focusFirst(problems);
      return;
    }
    setSaving(true);
    try {
      const payload: InventoryLotCreate = {
        lot_number: form.lot_number.trim() || undefined,
        expiration_date: form.expiration_date || undefined,
        quantity: Number(quantity),
        received_date: form.received_date || undefined,
        notes: form.notes.trim() || undefined,
      };
      const created = await inventoryService.addItemLot(itemId, payload);
      setLots((prev) => [...prev, created]);
      closeForm();
      toast.success('Stock lot added');
    } catch (err: unknown) {
      // A refused field is flagged on that field (forms review F-2); anything
      // no field answers for is said in the form, with what was typed kept.
      lotErrors.focusFirst(lotErrors.setFromApiError(err, 'Failed to add stock lot'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (lot: InventoryLot) => {
    if (
      !(await confirm({
        title: 'Delete stock lot',
        message: 'Delete this stock lot? Its quantity and expiry come off the item, and this cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await inventoryService.deleteItemLot(lot.id);
      setLots((prev) => prev.filter((l) => l.id !== lot.id));
      toast.success('Stock lot deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete stock lot'));
    }
  };

  const adjustQuantity = async (lotId: string, delta: number) => {
    // Compute the new quantity from the latest state (not a render-time
    // closure) so rapid clicks don't stack onto a stale base.
    let target: number | null = null;
    setLots((prev) =>
      prev.map((l) => {
        if (l.id !== lotId) return l;
        target = Math.max(0, l.quantity + delta);
        return { ...l, quantity: target };
      })
    );
    if (target === null) return;
    try {
      await inventoryService.updateItemLot(lotId, { quantity: target });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update quantity'));
      // Re-sync from the server rather than guessing the pre-click value.
      void load();
    }
  };

  const today = getTodayLocalDate(tz);

  const daysLeft = (lot: InventoryLot): number | null => {
    if (!lot.expiration_date) return null;
    const day = 24 * 60 * 60 * 1000;
    return Math.round(
      (new Date(`${lot.expiration_date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / day
    );
  };

  const expiryState = (lot: InventoryLot): 'expired' | 'soon' | 'ok' => {
    const d = daysLeft(lot);
    if (d === null) return 'ok';
    if (d < 0) return 'expired';
    if (d <= 30) return 'soon';
    return 'ok';
  };

  // An expired lot is not ready stock: the server skips it when it issues or
  // swaps, and Medical Supplies leaves it out of on-hand. Counting it here made
  // this panel disagree with that page about the same item.
  const totalReady = lots.reduce((sum, l) => (expiryState(l) === 'expired' ? sum : sum + l.quantity), 0);
  const totalExpired = lots.reduce((sum, l) => (expiryState(l) === 'expired' ? sum + l.quantity : sum), 0);
  const lotName = (lot: InventoryLot): string => (lot.lot_number ? `lot ${lot.lot_number}` : 'unnumbered lot');

  const daysLeftLabel = (d: number): string => (d < 0 ? `${Math.abs(d)}d ago` : d === 0 ? 'today' : `${d}d left`);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-theme-text-muted text-sm">
          <span className="text-theme-text-primary font-semibold">{totalReady}</span> ready unit
          {totalReady !== 1 ? 's' : ''} across {lots.length} lot{lots.length !== 1 ? 's' : ''}
          {totalExpired > 0 && ` · ${totalExpired} expired`}
        </div>
        {canManage && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-primary btn-sm inline-flex items-center gap-1"
          >
            <Plus className="h-4 w-4" /> Add Lot
          </button>
        )}
      </div>

      {showForm && canManage && (
        <form noValidate onSubmit={(e) => void handleAdd(e)} className="card-secondary space-y-3 p-4">
          {lotErrors.formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {lotErrors.formError}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              id={LOT_FIELDS.lot_number.id}
              label={LOT_FIELDS.lot_number.label}
              error={lotErrors.errors.lot_number}
              maxLength={LOT_LIMITS.lot_number}
              count={form.lot_number.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  className="form-input"
                  placeholder="e.g. LOT-4823"
                  value={form.lot_number}
                  onChange={(e) => set({ lot_number: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              id={LOT_FIELDS.quantity.id}
              label={LOT_FIELDS.quantity.label}
              required
              error={lotErrors.errors.quantity}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className="form-input"
                  value={form.quantity}
                  onChange={(e) => set({ quantity: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              id={LOT_FIELDS.expiration_date.id}
              label={LOT_FIELDS.expiration_date.label}
              error={lotErrors.errors.expiration_date}
            >
              {(field) => (
                <input
                  {...field}
                  type="date"
                  className="form-input"
                  value={form.expiration_date}
                  onChange={(e) => set({ expiration_date: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              id={LOT_FIELDS.received_date.id}
              label={LOT_FIELDS.received_date.label}
              error={lotErrors.errors.received_date}
            >
              {(field) => (
                <input
                  {...field}
                  type="date"
                  className="form-input"
                  value={form.received_date}
                  onChange={(e) => set({ received_date: e.target.value })}
                />
              )}
            </FormField>
          </div>
          <FormField
            id={LOT_FIELDS.notes.id}
            label={LOT_FIELDS.notes.label}
            error={lotErrors.errors.notes}
            maxLength={LOT_LIMITS.notes}
            count={form.notes.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                className="form-input"
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            )}
          </FormField>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary btn-sm inline-flex items-center gap-1 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
              Save Lot
            </button>
            <button type="button" onClick={requestCancel} className="btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {lots.length === 0 ? (
        <div className="border-theme-surface-border text-theme-text-muted rounded-lg border border-dashed p-6 text-center text-sm">
          No ready stock yet. Add a lot to keep fresh units on hand for swaps.
        </div>
      ) : (
        <ul className="space-y-2">
          {lots.map((lot) => {
            const state = expiryState(lot);
            return (
              <li
                key={lot.id}
                className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                  state === 'expired'
                    ? 'border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10'
                    : state === 'soon'
                      ? 'border-yellow-300 bg-yellow-50 dark:border-yellow-900/50 dark:bg-yellow-900/10'
                      : 'border-theme-surface-border bg-theme-surface'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-theme-text-primary font-medium">{lot.lot_number || 'No lot #'}</span>
                    {lot.expiration_date && (
                      <span
                        className={`inline-flex items-center gap-1 text-xs ${
                          state === 'expired'
                            ? 'font-medium text-red-600 dark:text-red-400'
                            : state === 'soon'
                              ? 'font-medium text-yellow-700 dark:text-yellow-400'
                              : 'text-theme-text-muted'
                        }`}
                      >
                        {state === 'expired' && <AlertTriangle className="h-3 w-3" />}
                        {state === 'soon' && <Clock className="h-3 w-3" />}
                        {state === 'expired' ? 'Expired ' : 'Exp '}
                        {formatCalendarDate(lot.expiration_date)}
                        {(() => {
                          const d = daysLeft(lot);
                          return d === null ? null : <span className="opacity-70">· {daysLeftLabel(d)}</span>;
                        })()}
                      </span>
                    )}
                  </div>
                  {lot.notes && <p className="text-theme-text-muted mt-0.5 truncate text-xs">{lot.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Decrease ${lotName(lot)}`}
                        onClick={() => void adjustQuantity(lot.id, -1)}
                        className="btn-icon"
                      >
                        −
                      </button>
                      <span className="text-theme-text-primary w-8 text-center font-semibold">{lot.quantity}</span>
                      <button
                        type="button"
                        aria-label={`Increase ${lotName(lot)}`}
                        onClick={() => void adjustQuantity(lot.id, 1)}
                        className="btn-icon"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <span className="text-theme-text-primary font-semibold">{lot.quantity}</span>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      aria-label={`Delete ${lotName(lot)}`}
                      onClick={() => void handleDelete(lot)}
                      className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {deployments.length > 0 && (
        <div className="space-y-2 pt-2">
          <h4 className="text-theme-text-primary flex items-center gap-1.5 text-sm font-semibold">
            <Truck className="h-4 w-4" aria-hidden="true" />
            On apparatus ({deployments.length})
          </h4>
          <p className="text-theme-text-muted text-xs">
            Checklist positions this item fills. The date shown is what the truck is carrying now, not the shelf stock
            above.
          </p>
          <ul className="divide-theme-surface-border border-theme-surface-border divide-y rounded-lg border">
            {deployments.map((d) => (
              <li key={d.templateItemId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-theme-text-primary text-sm font-medium">
                    {d.apparatusName || d.apparatusType || d.templateName || 'Unassigned'}
                  </span>
                  <span className="text-theme-text-muted ml-2 text-xs">
                    {d.compartmentName ? `${d.compartmentName} · ` : ''}
                    {d.itemName}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {d.lotNumber && <span className="text-theme-text-muted font-mono">Lot {d.lotNumber}</span>}
                  {d.expirationDate && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                        d.isExpired
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : (d.daysUntilExpiration ?? 999) <= 30
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : 'text-theme-text-muted'
                      }`}
                    >
                      {d.isExpired ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {d.isExpired ? 'Expired ' : 'Exp '}
                      {formatCalendarDate(d.expirationDate)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default StockLotsPanel;
