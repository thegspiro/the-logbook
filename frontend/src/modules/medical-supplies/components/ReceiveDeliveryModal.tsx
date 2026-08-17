/**
 * ReceiveDeliveryModal — book a whole shipment in one pass.
 *
 * A delivery is many item lines, each with its own lot number and expiration
 * date, and entering them one item page at a time is the friction that keeps
 * dated stock from ever being recorded. The backend checks every line before
 * writing any of them, so a rejected shipment leaves nothing half-received.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { InventoryItem, InventoryLotBulkEntry } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { Modal } from '../../../components/Modal';

interface ReceiveDeliveryModalProps {
  items: InventoryItem[];
  onClose: () => void;
  onSaved: () => void;
}

interface Line {
  key: string;
  inventory_item_id: string;
  quantity: string;
  lot_number: string;
  expiration_date: string;
}

let lineCounter = 0;
const newLine = (): Line => ({
  key: `line-${(lineCounter += 1)}`,
  inventory_item_id: '',
  quantity: '',
  lot_number: '',
  expiration_date: '',
});

export const ReceiveDeliveryModal: React.FC<ReceiveDeliveryModalProps> = ({ items, onClose, onSaved }) => {
  const tz = useTimezone();
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [isSaving, setIsSaving] = useState(false);

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // A row is either untouched or a real line. Half-filled rows used to be
    // dropped by the same filter that selected the good ones, so a shipment
    // went in short and still reported success — the officer only found out by
    // recounting. Blank rows are ignored (they are just spare slots); a row
    // with one field filled is a mistake worth stopping for.
    const blank = (l: Line) => !l.inventory_item_id && l.quantity === '' && !l.lot_number && !l.expiration_date;
    const touched = lines.filter((l) => !blank(l));
    const incomplete = touched.filter((l) => !l.inventory_item_id || l.quantity === '');

    if (touched.length === 0) {
      toast.error('Add at least one line with an item and a quantity');
      return;
    }
    if (incomplete.length > 0) {
      toast.error(
        incomplete.length === 1
          ? 'One line is missing its item or quantity. Complete it or clear the row.'
          : `${incomplete.length} lines are missing an item or quantity. Complete them or clear the rows.`
      );
      return;
    }
    if (touched.some((l) => Number(l.quantity) < 1)) {
      toast.error('A received line needs a quantity of 1 or more');
      return;
    }

    const filled = touched;

    const entries: InventoryLotBulkEntry[] = filled.map((l) => ({
      inventory_item_id: l.inventory_item_id,
      quantity: Number(l.quantity),
      // Create path, so blanks are omitted rather than sent as empty strings.
      lot_number: l.lot_number.trim() || undefined,
      expiration_date: l.expiration_date || undefined,
      received_date: getTodayLocalDate(tz),
    }));

    setIsSaving(true);
    try {
      await medicalSuppliesService.receiveDelivery(entries);
      toast.success(`Received ${entries.length} line(s)`);
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to record the delivery'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Receive delivery" size="xl">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="modal-body space-y-3">
          {items.length === 0 ? (
            <div className="alert-warning">
              Add a medical supply first — a delivery is booked against existing items.
            </div>
          ) : (
            <>
              <p className="text-theme-text-muted text-sm">
                One line per item. Stock booked here becomes the replacement a crew can swap onto a rig during an
                equipment check.
              </p>

              <div className="space-y-2">
                {lines.map((line, index) => (
                  <div
                    key={line.key}
                    className="border-theme-surface-border grid gap-2 rounded-md border p-3 sm:grid-cols-12"
                  >
                    <div className="sm:col-span-5">
                      <label htmlFor={`${line.key}-item`} className="form-label">
                        Item {index === 0 && <span aria-hidden="true">*</span>}
                      </label>
                      <select
                        id={`${line.key}-item`}
                        className="form-input w-full"
                        value={line.inventory_item_id}
                        onChange={(e) => updateLine(line.key, { inventory_item_id: e.target.value })}
                      >
                        <option value="">Select an item</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor={`${line.key}-qty`} className="form-label">
                        Qty
                      </label>
                      <input
                        id={`${line.key}-qty`}
                        type="number"
                        min="1"
                        className="form-input w-full"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor={`${line.key}-lot`} className="form-label">
                        Lot #
                      </label>
                      <input
                        id={`${line.key}-lot`}
                        className="form-input w-full"
                        value={line.lot_number}
                        onChange={(e) => updateLine(line.key, { lot_number: e.target.value })}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor={`${line.key}-exp`} className="form-label">
                        Expires
                      </label>
                      <input
                        id={`${line.key}-exp`}
                        type="date"
                        className="form-input w-full"
                        value={line.expiration_date}
                        onChange={(e) => updateLine(line.key, { expiration_date: e.target.value })}
                      />
                    </div>

                    <div className="flex items-end sm:col-span-1">
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        className="btn-icon"
                        aria-label={`Remove line ${index + 1}`}
                        disabled={lines.length === 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setLines((ls) => [...ls, newLine()])}
                className="text-theme-text-primary hover:bg-theme-surface-secondary mobile-touch-target inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Add line
              </button>
            </>
          )}
        </div>

        <div className="border-theme-surface-border flex justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving || items.length === 0}>
            {isSaving ? 'Recording…' : 'Record delivery'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ReceiveDeliveryModal;
