/**
 * ReceiveStockModal
 *
 * Records an incoming delivery as dated stock lots — one line per item, each
 * with its own lot number and expiration.
 *
 * This is the supply side of the equipment-check swap: a lot recorded here is
 * immediately offered to crews in the check screen, so a member pulling an
 * expired, used or damaged unit has fresh stock to select and put on the
 * truck. Before this the only way in was one item-detail page at a time,
 * which is why that stock often did not exist when a crew went looking.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, PackagePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/Modal';
import { FormField } from '@/components/ux/FormField';
import InventoryItemPicker from '@/modules/inventory/components/InventoryItemPicker';
import { inventoryService } from '@/services/inventoryService';
import type { InventoryLotBulkEntry } from '@/services/eventServices';
import { getErrorMessage } from '@/utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import { getTodayLocalDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';

interface ReceiveStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Receives the ids of the items stock was received against. */
  onReceived?: (itemIds: string[]) => void;
}

interface LineState {
  key: string;
  itemId: string;
  itemName: string;
  lotNumber: string;
  expirationDate: string;
  quantity: string;
}

type LineField = 'item' | 'lotNumber' | 'expirationDate' | 'quantity';

function emptyLine(key: string): LineState {
  return { key, itemId: '', itemName: '', lotNumber: '', expirationDate: '', quantity: '1' };
}

/** `InventoryLotBase.lot_number` max_length. */
const LOT_NUMBER_MAX = 100;

/** Errors are keyed per line, so a refusal lands on the line that caused it. */
const errorKey = (lineKey: string, field: LineField) => `${lineKey}:${field}`;
const RECEIVED_KEY = 'receivedDate';

/** Each control's id, so the first refusal can take focus. */
const controlId = (lineKey: string, field: LineField) =>
  ({
    item: `item-${lineKey}`,
    lotNumber: `lot-${lineKey}`,
    expirationDate: `exp-${lineKey}`,
    quantity: `qty-${lineKey}`,
  })[field];

const labelClass = 'text-theme-text-secondary mb-1 block text-xs';

const ReceiveStockModal: React.FC<ReceiveStockModalProps> = ({ isOpen, onClose, onReceived }) => {
  const tz = useTimezone();
  // A delivery arrives on one date, so it is asked once rather than per line.
  const [receivedDate, setReceivedDate] = useState(() => getTodayLocalDate(tz));
  const [lines, setLines] = useState<LineState[]>([emptyLine('l0')]);
  const [nextKey, setNextKey] = useState(1);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // What the dialog held when it opened, so Escape, the X and Cancel ask
  // before throwing a half-entered delivery away (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const snapshot = JSON.stringify({ receivedDate, lines: lines.map(({ key: _key, ...rest }) => rest) });
  const isDirty = baseline !== '' && snapshot !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    if (!isOpen) return;
    const today = getTodayLocalDate(tz);
    setReceivedDate(today);
    setLines([emptyLine('l0')]);
    setNextKey(1);
    setErrors({});
    const { key: _key, ...blank } = emptyLine('l0');
    setBaseline(JSON.stringify({ receivedDate: today, lines: [blank] }));
  }, [isOpen, tz]);

  const clearError = (key: string) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _gone, ...rest } = prev;
      return rest;
    });

  const showErrors = (next: Record<string, string>) => {
    setErrors(next);
    // Focus follows the screen's order: the date, then each line top to bottom.
    const order = [
      ...(next[RECEIVED_KEY] ? ['receive-date'] : []),
      ...lines.flatMap((l) =>
        (['item', 'lotNumber', 'expirationDate', 'quantity'] as LineField[])
          .filter((f) => next[errorKey(l.key, f)])
          .map((f) => controlId(l.key, f))
      ),
    ];
    const first = order[0];
    if (first) window.setTimeout(() => document.getElementById(first)?.focus(), 0);
  };

  const addLine = () => {
    setLines((prev) => [...prev, emptyLine(`l${String(nextKey)}`)]);
    setNextKey((k) => k + 1);
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length === 1 ? [emptyLine('l0')] : prev.filter((l) => l.key !== key)));
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${key}:`))));
  };

  const updateLine = (key: string, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    for (const field of Object.keys(patch)) {
      clearError(errorKey(key, field === 'itemId' || field === 'itemName' ? 'item' : (field as LineField)));
    }
  };

  const filledLines = lines.filter((l) => l.itemId);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // A create: nothing is received until every flagged field is fixed.
    const found: Record<string, string> = {};
    const firstLine = lines[0];
    if (filledLines.length === 0 && firstLine) found[errorKey(firstLine.key, 'item')] = 'Pick an item for this line.';
    for (const l of filledLines) {
      if (!(Number(l.quantity) >= 1)) found[errorKey(l.key, 'quantity')] = 'Enter a quantity of at least 1.';
    }
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }

    setSaving(true);
    try {
      // Create payload: blanks are omitted rather than sent as empty strings.
      const entries: InventoryLotBulkEntry[] = filledLines.map((l) => ({
        inventory_item_id: l.itemId,
        quantity: Number(l.quantity),
        lot_number: l.lotNumber.trim() || undefined,
        expiration_date: l.expirationDate || undefined,
        received_date: receivedDate || undefined,
      }));
      const created = await inventoryService.addLotsBulk(entries);
      toast.success(`Received ${String(created.length)} lot${created.length === 1 ? '' : 's'}`);
      onReceived?.(Array.from(new Set(entries.map((entry) => entry.inventory_item_id))));
      onClose();
    } catch (err: unknown) {
      // The API answers per entry (`entries.2.lot_number`); each lands on its line.
      const specs: Record<string, ServerFieldSpec> = {
        [RECEIVED_KEY]: { label: 'Received', api: filledLines.map((_, i) => `entries.${String(i)}.received_date`) },
      };
      filledLines.forEach((l, i) => {
        const at = `entries.${String(i)}`;
        specs[errorKey(l.key, 'item')] = { label: 'Item', api: `${at}.inventory_item_id` };
        specs[errorKey(l.key, 'lotNumber')] = { label: 'Lot #', maxLength: LOT_NUMBER_MAX, api: `${at}.lot_number` };
        specs[errorKey(l.key, 'expirationDate')] = { label: 'Expiration', api: `${at}.expiration_date` };
        specs[errorKey(l.key, 'quantity')] = { label: 'Quantity', api: `${at}.quantity` };
      });
      const mapped = mapServerFieldErrors(err, specs);
      const fieldErrors = Object.fromEntries(
        Object.entries(mapped?.fieldErrors ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1]))
      );
      if (Object.keys(fieldErrors).length > 0) {
        showErrors(fieldErrors);
        toast.error(mapped?.unmatched.join(' ') || 'Fix the fields marked below, then receive again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to receive stock'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Receive Stock"
      size="lg"
      onSubmit={(e) => void submit(e)}
      noValidate
      footer={
        <>
          <button
            type="submit"
            disabled={saving || filledLines.length === 0}
            className="btn-info btn-md ml-2 inline-flex items-center gap-2 disabled:opacity-50"
          >
            <PackagePlus className="h-4 w-4" />
            {saving ? 'Receiving…' : `Receive ${String(filledLines.length)} lot${filledLines.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary btn-md">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-theme-text-muted text-sm">
          Each line becomes a dated stock lot. Crews can select these in an equipment check to replace a unit they take
          off the truck.
        </p>

        <FormField
          label="Received"
          id="receive-date"
          labelClassName={labelClass}
          error={errors[RECEIVED_KEY]}
          className="sm:max-w-xs"
        >
          {(field) => (
            <input
              {...field}
              type="date"
              className="form-input"
              value={receivedDate}
              onChange={(e) => {
                setReceivedDate(e.target.value);
                clearError(RECEIVED_KEY);
              }}
            />
          )}
        </FormField>

        <ul className="space-y-3">
          {lines.map((line, idx) => (
            <li key={line.key} className="card-secondary space-y-3 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-theme-text-muted text-xs font-medium">Line {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  className="rounded p-1 text-red-800 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                  aria-label={`Remove line ${String(idx + 1)}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <FormField
                label="Item"
                required
                id={controlId(line.key, 'item')}
                labelClassName={labelClass}
                error={errors[errorKey(line.key, 'item')]}
              >
                {(field) => (
                  <InventoryItemPicker
                    value={line.itemId || undefined}
                    placeholder="Search inventory…"
                    controlProps={field}
                    onChange={(id, name) =>
                      updateLine(line.key, {
                        itemId: id ?? '',
                        itemName: name ?? '',
                      })
                    }
                  />
                )}
              </FormField>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FormField
                  label="Lot #"
                  id={controlId(line.key, 'lotNumber')}
                  labelClassName={labelClass}
                  error={errors[errorKey(line.key, 'lotNumber')]}
                  maxLength={LOT_NUMBER_MAX}
                  count={line.lotNumber.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      className="form-input"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={line.lotNumber}
                      onChange={(e) => updateLine(line.key, { lotNumber: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField
                  label="Expiration"
                  id={controlId(line.key, 'expirationDate')}
                  labelClassName={labelClass}
                  error={errors[errorKey(line.key, 'expirationDate')]}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="date"
                      className="form-input"
                      value={line.expirationDate}
                      onChange={(e) => updateLine(line.key, { expirationDate: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField
                  label="Quantity"
                  required
                  id={controlId(line.key, 'quantity')}
                  labelClassName={labelClass}
                  error={errors[errorKey(line.key, 'quantity')]}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      className="form-input"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    />
                  )}
                </FormField>
              </div>
            </li>
          ))}
        </ul>

        <button type="button" onClick={addLine} className="btn-secondary btn-sm inline-flex items-center gap-1">
          <Plus className="h-4 w-4" /> Add line
        </button>
      </div>
    </Modal>
  );
};

export default ReceiveStockModal;
