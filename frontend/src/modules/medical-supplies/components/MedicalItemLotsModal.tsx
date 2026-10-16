/**
 * MedicalItemLotsModal — the dated stock lots behind one medical supply.
 *
 * A lot-stocked supply's count lives here, not on the item: its edit form
 * says so and used to stop there, with nowhere on Medical Supplies to see a
 * lot, correct a miscounted one or remove an emptied one. The inventory
 * module's StockLotsPanel does this job for gear, but it calls the general
 * /inventory routes, which a medical-only supply officer is refused; this
 * talks to the medical-domain lot routes instead.
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
import { supplyLabel } from '../types';

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
  const [addForm, setAddForm] = useState<LotForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  const today = getTodayLocalDate(tz);
  const label = supplyLabel(item);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setLots(await medicalSuppliesService.getItemLots(item.id));
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Failed to load stock lots'));
    }
  }, [item.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const close = () => {
    if (changed) onChanged();
    onClose();
  };

  const startEdit = (lot: InventoryLot) => {
    setEditingId(lot.id);
    setEditForm({
      lot_number: lot.lot_number ?? '',
      expiration_date: lot.expiration_date ?? '',
      quantity: String(lot.quantity),
    });
  };

  const saveEdit = async (lot: InventoryLot) => {
    const quantity = Number(editForm.quantity);
    if (editForm.quantity === '' || !Number.isInteger(quantity) || quantity < 0) {
      toast.error('Enter a quantity of 0 or more');
      return;
    }
    setBusy(true);
    try {
      // Update: a cleared box is sent as null so the clear persists, rather
      // than omitted and silently kept (CLAUDE.md pitfall #1).
      await medicalSuppliesService.updateLot(lot.id, {
        lot_number: editForm.lot_number.trim() || null,
        expiration_date: editForm.expiration_date || null,
        quantity,
      });
      setEditingId(null);
      setChanged(true);
      toast.success('Lot updated');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update the lot'));
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
    const quantity = Number(addForm.quantity);
    if (addForm.quantity === '' || !Number.isInteger(quantity) || quantity < 1) {
      toast.error('A new lot needs a quantity of 1 or more');
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
      toast.error(getErrorMessage(err, 'Failed to add the lot'));
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
      title={`Lots — ${label}`}
      size="xl"
      footer={
        <button type="button" onClick={close} className={smallButton}>
          Done
        </button>
      }
    >
      <div className="space-y-4">
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
                            <input
                              className="form-input w-32"
                              aria-label={`Lot number for lot ${lotName}`}
                              maxLength={100}
                              value={editForm.lot_number}
                              onChange={(e) => setEditForm((f) => ({ ...f, lot_number: e.target.value }))}
                            />
                          ) : (
                            lot.lot_number || '—'
                          )}
                        </td>
                        <td data-label="Expires" className="px-3 py-2">
                          {editing ? (
                            <input
                              type="date"
                              className="form-input w-40"
                              aria-label={`Expiration date for lot ${lotName}`}
                              value={editForm.expiration_date}
                              onChange={(e) => setEditForm((f) => ({ ...f, expiration_date: e.target.value }))}
                            />
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
                            <input
                              type="number"
                              min="0"
                              className="form-input w-24 text-right"
                              aria-label={`Quantity for lot ${lotName}`}
                              value={editForm.quantity}
                              onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))}
                            />
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
                                  onClick={() => setEditingId(null)}
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
          </>
        )}

        {canManage && lots && (
          <form
            onSubmit={(e) => void add(e)}
            className="border-theme-surface-border space-y-2 rounded-md border p-3"
            aria-labelledby="add-lot-heading"
          >
            <h3 id="add-lot-heading" className="text-theme-text-primary text-sm font-semibold">
              Add a lot
            </h3>
            <div className="grid gap-2 sm:grid-cols-4">
              <div>
                <label htmlFor="new-lot-number" className="form-label">
                  Lot #
                </label>
                <input
                  id="new-lot-number"
                  className="form-input w-full"
                  maxLength={100}
                  value={addForm.lot_number}
                  onChange={(e) => setAddForm((f) => ({ ...f, lot_number: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="new-lot-expires" className="form-label">
                  Expires
                </label>
                <input
                  id="new-lot-expires"
                  type="date"
                  className="form-input w-full"
                  value={addForm.expiration_date}
                  onChange={(e) => setAddForm((f) => ({ ...f, expiration_date: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="new-lot-qty" className="form-label">
                  Quantity <span aria-hidden="true">*</span>
                </label>
                <input
                  id="new-lot-qty"
                  type="number"
                  min="1"
                  className="form-input w-full"
                  value={addForm.quantity}
                  onChange={(e) => setAddForm((f) => ({ ...f, quantity: e.target.value }))}
                  required
                />
              </div>
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
