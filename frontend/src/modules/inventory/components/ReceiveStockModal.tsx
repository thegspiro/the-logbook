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

import React, { useState } from 'react';
import { Plus, Trash2, PackagePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/Modal';
import InventoryItemPicker from '@/modules/scheduling/components/InventoryItemPicker';
import { inventoryService } from '@/services/inventoryService';
import type { InventoryLotBulkEntry } from '@/services/eventServices';
import { getErrorMessage } from '@/utils/errorHandling';
import { getTodayLocalDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';

interface ReceiveStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReceived?: () => void;
}

interface LineState {
  key: string;
  itemId: string;
  itemName: string;
  lotNumber: string;
  expirationDate: string;
  quantity: string;
}

function emptyLine(key: string): LineState {
  return { key, itemId: '', itemName: '', lotNumber: '', expirationDate: '', quantity: '1' };
}

const labelClass = 'text-theme-text-secondary mb-1 block text-xs';

const ReceiveStockModal: React.FC<ReceiveStockModalProps> = ({ isOpen, onClose, onReceived }) => {
  const tz = useTimezone();
  // A delivery arrives on one date, so it is asked once rather than per line.
  const [receivedDate, setReceivedDate] = useState(() => getTodayLocalDate(tz));
  const [lines, setLines] = useState<LineState[]>([emptyLine('l0')]);
  const [nextKey, setNextKey] = useState(1);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setLines([emptyLine('l0')]);
    setNextKey(1);
    setReceivedDate(getTodayLocalDate(tz));
  };

  const addLine = () => {
    setLines((prev) => [...prev, emptyLine(`l${String(nextKey)}`)]);
    setNextKey((k) => k + 1);
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length === 1 ? [emptyLine('l0')] : prev.filter((l) => l.key !== key)));
  };

  const updateLine = (key: string, patch: Partial<LineState>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const filledLines = lines.filter((l) => l.itemId);

  const submit = async () => {
    if (filledLines.length === 0) {
      toast.error('Pick an item for at least one line');
      return;
    }
    const badQuantity = filledLines.find((l) => !(Number(l.quantity) >= 1));
    if (badQuantity) {
      toast.error(`Enter a quantity of at least 1 for ${badQuantity.itemName || 'each line'}`);
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
      reset();
      onReceived?.();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to receive stock'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Receive Stock"
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || filledLines.length === 0}
            className="btn-info btn-md ml-2 inline-flex items-center gap-2 disabled:opacity-50"
          >
            <PackagePlus className="h-4 w-4" />
            {saving ? 'Receiving…' : `Receive ${String(filledLines.length)} lot${filledLines.length === 1 ? '' : 's'}`}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary btn-md">
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

        <div className="sm:max-w-xs">
          <label htmlFor="receive-date" className={labelClass}>
            Received
          </label>
          <input
            id="receive-date"
            type="date"
            className="form-input"
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
          />
        </div>

        <ul className="space-y-3">
          {lines.map((line, idx) => (
            <li key={line.key} className="card-secondary space-y-3 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-theme-text-muted text-xs font-medium">Line {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  aria-label={`Remove line ${String(idx + 1)}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div>
                <label className={labelClass}>Item</label>
                <InventoryItemPicker
                  value={line.itemId || undefined}
                  placeholder="Search inventory…"
                  onChange={(id, name) =>
                    updateLine(line.key, {
                      itemId: id ?? '',
                      itemName: name ?? '',
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor={`lot-${line.key}`} className={labelClass}>
                    Lot #
                  </label>
                  <input
                    id={`lot-${line.key}`}
                    type="text"
                    className="form-input"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={line.lotNumber}
                    onChange={(e) => updateLine(line.key, { lotNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`exp-${line.key}`} className={labelClass}>
                    Expiration
                  </label>
                  <input
                    id={`exp-${line.key}`}
                    type="date"
                    className="form-input"
                    value={line.expirationDate}
                    onChange={(e) => updateLine(line.key, { expirationDate: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor={`qty-${line.key}`} className={labelClass}>
                    Quantity
                  </label>
                  <input
                    id={`qty-${line.key}`}
                    type="number"
                    min="1"
                    className="form-input"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  />
                </div>
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
