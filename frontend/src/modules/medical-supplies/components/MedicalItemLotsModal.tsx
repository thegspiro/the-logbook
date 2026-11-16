/**
 * MedicalItemLotsModal — the dated stock lots behind one medical supply.
 *
 * A lot-stocked supply's count lives here, not on the item: its edit form
 * says so and used to stop there, with nowhere on Medical Supplies to see a
 * lot, correct a miscounted one or remove an emptied one. The inventory
 * module's StockLotsPanel does this job for gear, but it calls the general
 * /inventory routes, which a medical-only supply officer is refused; this
 * talks to the medical-domain lot routes instead.
 *
 * It opens on where the supply is — its shelf and the apparatus carrying it —
 * because that is the other question asked of a supply's lots: an expiring lot
 * has to be found before it can be pulled.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { InventoryItem, InventoryLot } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCalendarDate, formatNumber, getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import { supplyLabel } from '../types';
import { SupplyWhereSection } from './SupplyWhereSection';

interface MedicalItemLotsModalProps {
  item: InventoryItem;
  canManage: boolean;
  onClose: () => void;
  /** Called on close when a lot was added, changed or removed, so the page reloads its counts. */
  onChanged: () => void;
}

interface LotForm {
  lot_number: string;
  expiration_date: string;
  quantity: string;
}

const EMPTY_FORM: LotForm = { lot_number: '', expiration_date: '', quantity: '' };

type LotField = keyof LotForm;
// Ordered as on screen, so the first refusal takes focus. Limits mirror
// InventoryLotBase / InventoryLotUpdate (lot_number max_length=100).
const ADD_FIELDS: FieldSpecs<LotField> = {
  lot_number: { id: 'new-lot-number', label: 'Lot #' },
  expiration_date: { id: 'new-lot-expires', label: 'Expires' },
  quantity: { id: 'new-lot-qty', label: 'Quantity' },
};
// One row is edited at a time, so the edit row's controls share fixed ids.
const EDIT_FIELDS: FieldSpecs<LotField> = {
  lot_number: { id: 'edit-lot-number', label: 'Lot number' },
  expiration_date: { id: 'edit-lot-expires', label: 'Expiration date' },
  quantity: { id: 'edit-lot-qty', label: 'Quantity' },
};
const LOT_ORDER = Object.keys(EDIT_FIELDS) as LotField[];
const LOT_NUMBER_MAX = 100;

/** Whole days from the department's today to a YYYY-MM-DD date; negative once it has passed. */
function daysUntil(dateOnly: string, today: string): number {
  return Math.round((Date.parse(`${dateOnly}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function expiryStatus(days: number): { label: string; tone: string } {
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, tone: 'text-red-700 dark:text-red-400' };
  if (days === 0) return { label: 'Expires today', tone: 'text-red-700 dark:text-red-400' };
  if (days <= 30) return { label: `${days}d left`, tone: 'text-amber-700 dark:text-amber-400' };
  return { label: `${days}d left`, tone: 'text-theme-text-muted' };
}

const smallButton =
  'mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50';

export const MedicalItemLotsModal: React.FC<MedicalItemLotsModalProps> = ({ item, canManage, onClose, onChanged }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [lots, setLots] = useState<InventoryLot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LotForm>(EMPTY_FORM);
  // What the edit row held when it opened (or last saved), so its Cancel asks
  // before throwing a typed change away.
  const [editBaseline, setEditBaseline] = useState<LotForm>(EMPTY_FORM);
  const [addForm, setAddForm] = useState<LotForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const addErrors = useFieldErrors(ADD_FIELDS);
  const editErrors = useFieldErrors(EDIT_FIELDS);
  const editDirty = editingId !== null && JSON.stringify(editForm) !== JSON.stringify(editBaseline);
  const addDirty = JSON.stringify(addForm) !== JSON.stringify(EMPTY_FORM);
  const setAdd = (patch: Partial<LotForm>) => {
    setAddForm((f) => ({ ...f, ...patch }));
    for (const key of Object.keys(patch)) addErrors.setError(key as LotField, null);
  };
  const setEdit = (patch: Partial<LotForm>) => {
    setEditForm((f) => ({ ...f, ...patch }));
    for (const key of Object.keys(patch)) editErrors.setError(key as LotField, null);
  };

  const today = getTodayLocalDate(tz);
  const label = supplyLabel(item);
  // No stock room behind it, so no shelf lots to list or add: what it carries
  // is counted, and dated, on the apparatus checklists.
  const apparatusOnly = Boolean(item.apparatus_only);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setLots(await medicalSuppliesService.getItemLots(item.id));
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Failed to load stock lots'));
    }
  }, [item.id]);

  useEffect(() => {
    if (!apparatusOnly) void load();
  }, [load, apparatusOnly]);

  // Done, Escape and the X ask before a typed lot or an open, changed edit
  // row is thrown away (forms review F-6).
  const close = useDiscardGuard({
    isDirty: editDirty || addDirty,
    onClose: () => {
      if (changed) onChanged();
      onClose();
    },
  });

  const startEdit = (lot: InventoryLot) => {
    const seeded: LotForm = {
      lot_number: lot.lot_number ?? '',
      expiration_date: lot.expiration_date ?? '',
      quantity: String(lot.quantity),
    };
    setEditingId(lot.id);
    setEditForm(seeded);
    setEditBaseline(seeded);
    editErrors.clear();
  };

  const cancelEdit = async () => {
    if (
      editDirty &&
      !(await confirm({
        title: 'Discard changes?',
        message: 'This lot has changes that have not been saved.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
      }))
    )
      return;
    setEditingId(null);
    editErrors.clear();
  };

  const saveEdit = async (lot: InventoryLot) => {
    // Named on the field rather than in a toast (forms review F-3).
    const problems: FieldErrors<LotField> = {};
    const quantity = Number(editForm.quantity);
    if (editForm.quantity === '' || !Number.isInteger(quantity) || quantity < 0)
      problems.quantity = 'Enter a whole number, 0 or more.';
    editErrors.setFormError(null);
    editErrors.setErrors(problems);
    setBusy(true);
    try {
      // Update: a cleared box is sent as null so the clear persists, rather
      // than omitted and silently kept (CLAUDE.md pitfall #1). A refused field
      // is left out and the rest saves (owner rule, 2026-11-05).
      const { refused } = await saveExceptRefused<LotField, unknown>({
        payload: {
          lot_number: editForm.lot_number.trim() || null,
          expiration_date: editForm.expiration_date || null,
          quantity,
        },
        refused: problems,
        send: (body) => medicalSuppliesService.updateLot(lot.id, body),
        place: (err) => placeApiError(EDIT_FIELDS, err),
      });
      setChanged(true);
      await load();
      const first = firstRefused(LOT_ORDER, refused);
      if (first) {
        // The row stays open with the refused field flagged; only that field
        // still counts as unsaved.
        editErrors.setErrors(refused);
        editErrors.setFormError(`Lot saved, except ${EDIT_FIELDS[first].label.toLowerCase()}. Fix it and save again.`);
        editErrors.focusFirst(refused);
        const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, editBaseline[k as LotField]]));
        setEditBaseline({ ...editForm, ...keep });
        return;
      }
      setEditingId(null);
      toast.success('Lot updated');
    } catch (err: unknown) {
      editErrors.focusFirst(editErrors.setFromApiError(err, 'Failed to update the lot'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (lot: InventoryLot) => {
    const confirmed = await confirm({
      title: 'Delete lot',
      message: `Delete lot ${lot.lot_number || 'without a number'} (${formatNumber(lot.quantity)} on hand) from ${label}? Its units leave the count.`,
      confirmLabel: 'Delete lot',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await medicalSuppliesService.deleteLot(lot.id);
      setChanged(true);
      toast.success('Lot deleted');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete the lot'));
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    // Named on the field rather than in a toast (forms review F-3). A new lot
    // is not created until every field is fixed (owner rule, 2026-11-05).
    const problems: FieldErrors<LotField> = {};
    const quantity = Number(addForm.quantity);
    if (addForm.quantity === '' || !Number.isInteger(quantity) || quantity < 1)
      problems.quantity = 'A new lot needs a whole number of 1 or more.';
    addErrors.setFormError(null);
    addErrors.setErrors(problems);
    if (Object.keys(problems).length > 0) {
      addErrors.focusFirst(problems);
      return;
    }
    setBusy(true);
    try {
      // Create: blanks omitted rather than sent as empty strings.
      await medicalSuppliesService.addItemLot(item.id, {
        lot_number: addForm.lot_number.trim() || undefined,
        expiration_date: addForm.expiration_date || undefined,
        quantity,
        received_date: today,
      });
      setAddForm(EMPTY_FORM);
      setChanged(true);
      toast.success('Lot added');
      await load();
    } catch (err: unknown) {
      // A refused field is flagged on it; anything no field answers for is
      // said in the form rather than a toast.
      addErrors.focusFirst(addErrors.setFromApiError(err, 'Failed to add the lot'));
    } finally {
      setBusy(false);
    }
  };

  const total = (lots ?? []).reduce(
    (sum, lot) => sum + (lot.expiration_date && daysUntil(lot.expiration_date, today) < 0 ? 0 : lot.quantity),
    0
  );

  return (
    <Modal
      isOpen
      onClose={close}
      title={apparatusOnly ? `Where it is carried — ${label}` : `Lots — ${label}`}
      size="xl"
      footer={
        <button type="button" onClick={close} className={smallButton}>
          Done
        </button>
      }
    >
      <div className="space-y-4">
        <SupplyWhereSection item={item} />
        {apparatusOnly ? (
          <p className="text-theme-text-muted border-theme-surface-border border-t pt-4 text-sm">
            Kept on apparatus only, so there are no stock-room lots. Counts and expiry dates are recorded on the
            apparatus checklists.
          </p>
        ) : (
          <h3 className="text-theme-text-primary border-theme-surface-border border-t pt-4 text-sm font-semibold">
            Stock lots
          </h3>
        )}
        {loadError && (
          <p role="alert" className="alert-danger text-sm">
            {loadError}
          </p>
        )}
        {!lots && !loadError && <p className="text-theme-text-muted text-sm">Loading lots…</p>}

        {lots && lots.length === 0 && (
          <p className="text-theme-text-muted text-sm">
            No stock lots yet. {canManage ? 'Add one below, or record a delivery.' : ''}
          </p>
        )}

        {lots && lots.length > 0 && (
          <>
            <p className="text-theme-text-secondary text-sm">
              {formatNumber(total)} usable on hand across {formatNumber(lots.length)} lot
              {lots.length === 1 ? '' : 's'}. Expired lots are not counted.
            </p>
            <div className="overflow-x-auto">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th className="text-theme-text-muted px-3 py-2 text-left text-xs font-semibold uppercase">Lot</th>
                    <th className="text-theme-text-muted px-3 py-2 text-left text-xs font-semibold uppercase">
                      Expires
                    </th>
                    <th className="text-theme-text-muted px-3 py-2 text-right text-xs font-semibold uppercase">
                      On hand
                    </th>
                    <th className="text-theme-text-muted px-3 py-2 text-left text-xs font-semibold uppercase">
                      Received
                    </th>
                    {canManage && (
                      <th className="px-3 py-2 text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lots.map((lot) => {
                    const editing = editingId === lot.id;
                    const status = lot.expiration_date ? expiryStatus(daysUntil(lot.expiration_date, today)) : null;
                    const lotName = lot.lot_number || 'without a number';
                    return (
                      <tr key={lot.id} className="border-theme-surface-border border-b last:border-0">
                        <td data-label="Lot" className="px-3 py-2 font-mono text-xs">
                          {editing ? (
                            <FormField
                              id={EDIT_FIELDS.lot_number.id}
                              label={`Lot number for lot ${lotName}`}
                              labelClassName="sr-only"
                              error={editErrors.errors.lot_number}
                              maxLength={LOT_NUMBER_MAX}
                            >
                              {(field) => (
                                <input
                                  {...field}
                                  className="form-input w-32"
                                  value={editForm.lot_number}
                                  onChange={(e) => setEdit({ lot_number: e.target.value })}
                                />
                              )}
                            </FormField>
                          ) : (
                            lot.lot_number || '—'
                          )}
                        </td>
                        <td data-label="Expires" className="px-3 py-2">
                          {editing ? (
                            <FormField
                              id={EDIT_FIELDS.expiration_date.id}
                              label={`Expiration date for lot ${lotName}`}
                              labelClassName="sr-only"
                              error={editErrors.errors.expiration_date}
                            >
                              {(field) => (
                                <input
                                  {...field}
                                  type="date"
                                  className="form-input w-40"
                                  value={editForm.expiration_date}
                                  onChange={(e) => setEdit({ expiration_date: e.target.value })}
                                />
                              )}
                            </FormField>
                          ) : lot.expiration_date ? (
                            <span>
                              {formatCalendarDate(lot.expiration_date)}
                              {status && (
                                <span className={`ml-2 text-xs font-medium ${status.tone}`}>{status.label}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-theme-text-muted">No expiry</span>
                          )}
                        </td>
                        <td data-label="On hand" className="px-3 py-2 text-right tabular-nums">
                          {editing ? (
                            <FormField
                              id={EDIT_FIELDS.quantity.id}
                              label={`Quantity for lot ${lotName}`}
                              labelClassName="sr-only"
                              error={editErrors.errors.quantity}
                            >
                              {(field) => (
                                <input
                                  {...field}
                                  type="number"
                                  min="0"
                                  step="1"
                                  className="form-input w-24 text-right"
                                  value={editForm.quantity}
                                  onChange={(e) => setEdit({ quantity: e.target.value })}
                                />
                              )}
                            </FormField>
                          ) : (
                            formatNumber(lot.quantity)
                          )}
                        </td>
                        <td data-label="Received" className="text-theme-text-muted px-3 py-2">
                          {lot.received_date ? formatCalendarDate(lot.received_date) : '—'}
                        </td>
                        {canManage && (
                          <td data-label="Actions" className="px-3 py-2 text-right whitespace-nowrap">
                            {editing ? (
                              <span className="inline-flex gap-2">
                                <button
                                  type="button"
                                  className="btn-primary px-3 py-1.5 text-sm"
                                  disabled={busy}
                                  onClick={() => void saveEdit(lot)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className={smallButton}
                                  disabled={busy}
                                  onClick={() => void cancelEdit()}
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  aria-label={`Edit lot ${lotName}`}
                                  disabled={busy}
                                  onClick={() => startEdit(lot)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  aria-label={`Delete lot ${lotName}`}
                                  disabled={busy}
                                  onClick={() => void remove(lot)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {editingId !== null && editErrors.formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {editErrors.formError}
              </p>
            )}
          </>
        )}

        {canManage && lots && (
          <form
            noValidate
            onSubmit={(e) => void add(e)}
            className="border-theme-surface-border space-y-2 rounded-md border p-3"
            aria-labelledby="add-lot-heading"
          >
            <h3 id="add-lot-heading" className="text-theme-text-primary text-sm font-semibold">
              Add a lot
            </h3>
            {addErrors.formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {addErrors.formError}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-4">
              <FormField
                id={ADD_FIELDS.lot_number.id}
                label="Lot #"
                error={addErrors.errors.lot_number}
                maxLength={LOT_NUMBER_MAX}
                count={addForm.lot_number.length}
              >
                {(field) => (
                  <input
                    {...field}
                    className="form-input w-full"
                    value={addForm.lot_number}
                    onChange={(e) => setAdd({ lot_number: e.target.value })}
                  />
                )}
              </FormField>
              <FormField id={ADD_FIELDS.expiration_date.id} label="Expires" error={addErrors.errors.expiration_date}>
                {(field) => (
                  <input
                    {...field}
                    type="date"
                    className="form-input w-full"
                    value={addForm.expiration_date}
                    onChange={(e) => setAdd({ expiration_date: e.target.value })}
                  />
                )}
              </FormField>
              <FormField id={ADD_FIELDS.quantity.id} label="Quantity" required error={addErrors.errors.quantity}>
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min="1"
                    step="1"
                    className="form-input w-full"
                    value={addForm.quantity}
                    onChange={(e) => setAdd({ quantity: e.target.value })}
                  />
                )}
              </FormField>
              <div className="flex items-end">
                <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add lot
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
