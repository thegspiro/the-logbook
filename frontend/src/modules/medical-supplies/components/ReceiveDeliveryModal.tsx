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
import type { InventoryLotBulkEntry } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { MedicalSupplyItemPicker } from './MedicalSupplyItemPicker';

interface ReceiveDeliveryModalProps {
  onClose: () => void;
  onSaved: () => void;
}

interface Line {
  key: string;
  inventory_item_id: string;
  inventory_item_name?: string | undefined;
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

type LineField = 'item' | 'quantity' | 'lot' | 'expiration';
const LINE_FIELDS: LineField[] = ['item', 'quantity', 'lot', 'expiration'];

/** `InventoryLotBase.lot_number` max_length. */
const LOT_NUMBER_MAX = 100;

/** Errors are keyed per line, so a refusal lands on the line that caused it. */
const errorKey = (lineKey: string, field: LineField) => `${lineKey}:${field}`;
const controlId = (lineKey: string, field: LineField) =>
  `${lineKey}-${({ item: 'item', quantity: 'qty', lot: 'lot', expiration: 'exp' } as const)[field]}`;

const isBlank = (l: Line) => !l.inventory_item_id && l.quantity === '' && !l.lot_number && !l.expiration_date;

export const ReceiveDeliveryModal: React.FC<ReceiveDeliveryModalProps> = ({ onClose, onSaved }) => {
  const tz = useTimezone();
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A half-entered shipment is lost on close, so Escape, the X and Cancel ask
  // first (forms review F-6). A spare blank row is not a change.
  const isDirty = lines.some((l) => !isBlank(l));
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const fieldOf = (patchKey: string): LineField =>
    patchKey === 'quantity'
      ? 'quantity'
      : patchKey === 'lot_number'
        ? 'lot'
        : patchKey === 'expiration_date'
          ? 'expiration'
          : 'item';

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    const cleared = new Set(Object.keys(patch).map((k) => errorKey(key, fieldOf(k))));
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !cleared.has(k))));
  };

  const removeLine = (key: string) => {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${key}:`))));
  };

  const showErrors = (next: Record<string, string>) => {
    setErrors(next);
    const first = lines.flatMap((l) =>
      LINE_FIELDS.filter((f) => next[errorKey(l.key, f)]).map((f) => controlId(l.key, f))
    )[0];
    if (first) window.setTimeout(() => document.getElementById(first)?.focus(), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // A row is either untouched or a real line. Half-filled rows used to be
    // dropped by the same filter that selected the good ones, so a shipment
    // went in short and still reported success — the officer only found out by
    // recounting. Blank rows are ignored (they are just spare slots); a row
    // with one field filled is a mistake worth stopping for.
    // Each problem is flagged on its own line's field; the toast says how
    // many lines need attention, since a long shipment can scroll them away.
    const touched = lines.filter((l) => !isBlank(l));
    const incomplete = touched.filter((l) => !l.inventory_item_id || l.quantity === '');
    const found: Record<string, string> = {};

    if (touched.length === 0) {
      const firstLine = lines[0];
      if (firstLine) found[errorKey(firstLine.key, 'item')] = 'Choose an item and enter a quantity.';
      showErrors(found);
      toast.error('Add at least one line with an item and a quantity');
      return;
    }
    if (incomplete.length > 0) {
      for (const l of incomplete) {
        if (!l.inventory_item_id) found[errorKey(l.key, 'item')] = 'Choose the item, or clear this row.';
        if (l.quantity === '') found[errorKey(l.key, 'quantity')] = 'Enter a quantity, or clear this row.';
      }
      showErrors(found);
      toast.error(
        incomplete.length === 1
          ? 'One line is missing its item or quantity. Complete it or clear the row.'
          : `${incomplete.length} lines are missing an item or quantity. Complete them or clear the rows.`
      );
      return;
    }
    const tooFew = touched.filter((l) => Number(l.quantity) < 1);
    if (tooFew.length > 0) {
      for (const l of tooFew) found[errorKey(l.key, 'quantity')] = 'Enter 1 or more.';
      showErrors(found);
      toast.error('Each line needs a quantity of 1 or more');
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
      toast.success(`Delivery recorded: ${entries.length} ${entries.length === 1 ? 'line' : 'lines'}`);
      onSaved();
    } catch (err: unknown) {
      // The API answers per entry (`entries.2.lot_number`); each lands on its line.
      const specs: Record<string, ServerFieldSpec> = {};
      filled.forEach((l, i) => {
        const at = `entries.${String(i)}`;
        specs[errorKey(l.key, 'item')] = { label: 'Item', api: `${at}.inventory_item_id` };
        specs[errorKey(l.key, 'quantity')] = { label: 'Qty', api: `${at}.quantity` };
        specs[errorKey(l.key, 'lot')] = { label: 'Lot #', maxLength: LOT_NUMBER_MAX, api: `${at}.lot_number` };
        specs[errorKey(l.key, 'expiration')] = { label: 'Expires', api: `${at}.expiration_date` };
      });
      const mapped = mapServerFieldErrors(err, specs);
      const fieldErrors = Object.fromEntries(
        Object.entries(mapped?.fieldErrors ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1]))
      );
      if (Object.keys(fieldErrors).length > 0) {
        showErrors(fieldErrors);
        toast.error(mapped?.unmatched.join(' ') || 'Fix the fields marked below, then record again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to record the delivery'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Receive delivery"
      size="xl"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Recording…' : 'Record delivery'}
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <>
          <p className="text-theme-text-muted text-sm">
            Add one line per item. Crews can swap stock recorded here onto a rig during an equipment check.
          </p>

          <div className="space-y-2">
            {lines.map((line, index) => (
              // Every line repeats the same four field names; the group is
              // what tells a screen reader which line it is in.
              <div
                key={line.key}
                role="group"
                aria-label={`Line ${index + 1}`}
                className="border-theme-surface-border grid gap-2 rounded-md border p-3 sm:grid-cols-12"
              >
                <FormField
                  className="sm:col-span-5"
                  label={<>Item {index === 0 && <span aria-hidden="true">*</span>}</>}
                  id={controlId(line.key, 'item')}
                  error={errors[errorKey(line.key, 'item')]}
                >
                  {(field) => (
                    <MedicalSupplyItemPicker
                      id={field.id}
                      controlProps={field}
                      value={line.inventory_item_id}
                      selectedName={line.inventory_item_name}
                      onChange={(itemId, name) =>
                        updateLine(line.key, { inventory_item_id: itemId, inventory_item_name: name })
                      }
                    />
                  )}
                </FormField>

                <FormField
                  className="sm:col-span-2"
                  label="Qty"
                  id={controlId(line.key, 'quantity')}
                  error={errors[errorKey(line.key, 'quantity')]}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      className="form-input w-full"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    />
                  )}
                </FormField>

                <FormField
                  className="sm:col-span-2"
                  label="Lot #"
                  id={controlId(line.key, 'lot')}
                  error={errors[errorKey(line.key, 'lot')]}
                  maxLength={LOT_NUMBER_MAX}
                  count={line.lot_number.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="form-input w-full"
                      value={line.lot_number}
                      onChange={(e) => updateLine(line.key, { lot_number: e.target.value })}
                    />
                  )}
                </FormField>

                <FormField
                  className="sm:col-span-2"
                  label="Expires"
                  id={controlId(line.key, 'expiration')}
                  error={errors[errorKey(line.key, 'expiration')]}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="date"
                      className="form-input w-full"
                      value={line.expiration_date}
                      onChange={(e) => updateLine(line.key, { expiration_date: e.target.value })}
                    />
                  )}
                </FormField>

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
      </div>
    </Modal>
  );
};

export default ReceiveDeliveryModal;
