/**
 * BulkAddItemsModal
 *
 * Paste a list of supply names; get a catalog.
 *
 * Stocking a catalog is a list-shaped job — a department types up its
 * consumables once, thirty lines at a time — and the one-item-at-a-time modal
 * is what leaves that catalog half-built. A half-built catalog is what leaves
 * checklist positions unlinked, which is what leaves expirations untracked, so
 * this is upstream of most of what the supply side is for.
 *
 * Optional trailing columns let a paste carry quantity and unit without
 * becoming a spreadsheet exercise (see `utils/bulkItemLines`). Everything else
 * about an item is edited afterwards, on the item, where there is room for it.
 */

import React, { useMemo, useState } from 'react';
import { Loader2, PackagePlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/Modal';
import { inventoryService } from '@/services/inventoryService';
import { getErrorMessage } from '@/utils/errorHandling';
import type { InventoryCategory, InventoryItemBulkEntry } from '@/services/api';
import { parseBulkLines } from '../utils/bulkItemLines';

interface BulkAddItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: InventoryCategory[];
  /** Fired after a successful write so the list behind can refresh. */
  onCreated: () => void;
}

const BulkAddItemsModal: React.FC<BulkAddItemsModalProps> = ({ isOpen, onClose, categories, onCreated }) => {
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [trackingType, setTrackingType] = useState<'pool' | 'individual'>('pool');
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(() => parseBulkLines(text), [text]);

  const reset = () => {
    setText('');
    setCategoryId('');
    setTrackingType('pool');
  };

  const submit = async () => {
    if (parsed.length === 0) return;
    setSaving(true);
    try {
      const entries: InventoryItemBulkEntry[] = parsed.map((line) => ({
        name: line.name,
        tracking_type: trackingType,
        // Pool items must carry a count; an unstated one is zero on hand,
        // not one, because nothing has been received yet.
        quantity: line.quantity ?? (trackingType === 'pool' ? 0 : 1),
        // `||` not `??`: an empty select is '' and must not reach the API.
        ...(categoryId || undefined ? { category_id: categoryId } : {}),
        ...(line.unitOfMeasure ? { unit_of_measure: line.unitOfMeasure } : {}),
      }));

      const result = await inventoryService.createItemsBulk(entries);

      if (result.created > 0) {
        toast.success(`Added ${result.created} item${result.created === 1 ? '' : 's'} to inventory`);
      }
      if (result.skipped.length > 0) {
        toast(
          `${result.skipped.length} already in inventory and left alone: ${result.skipped
            .slice(0, 3)
            .join(', ')}${result.skipped.length > 3 ? '…' : ''}`,
          { icon: 'ℹ️' }
        );
      }
      onCreated();
      reset();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add the items'));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-theme-text-muted text-xs">
        {parsed.length > 0 ? `${parsed.length} item${parsed.length === 1 ? '' : 's'} to add` : 'Paste a list'}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary rounded-md border px-4 py-2 text-sm"
        >
          <X className="mr-1 inline h-3.5 w-3.5" />
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || parsed.length === 0}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
          Add {parsed.length || ''} item{parsed.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add several items" size="lg" footer={footer}>
      <div className="modal-body space-y-4">
        <div>
          <label className="form-label" htmlFor="bulk-add-list">
            One item per line
          </label>
          <textarea
            id="bulk-add-list"
            className="form-input font-mono text-sm"
            rows={10}
            placeholder={'Gauze Pads, 4x4 Sterile\nNitrile Gloves, Large\nOropharyngeal Airway Set | 2 | Set'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-theme-text-muted mt-1 text-xs">
            Add <code className="font-mono">| quantity | unit</code> after a name to set those too. Names already in
            your inventory are skipped.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="bulk-add-category">
              Category
            </label>
            <select
              id="bulk-add-category"
              className="form-input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="bulk-add-tracking">
              Tracking
            </label>
            <select
              id="bulk-add-tracking"
              className="form-input"
              value={trackingType}
              onChange={(e) => setTrackingType(e.target.value === 'individual' ? 'individual' : 'pool')}
            >
              <option value="pool">Counted (consumables, supplies)</option>
              <option value="individual">Serialized (one record per unit)</option>
            </select>
            <p className="text-theme-text-muted mt-1 text-xs">
              Counted is right for anything a checklist counts — a bracket holds four gauze, not gauze #7.
            </p>
          </div>
        </div>

        {parsed.length > 0 && (
          <div className="border-theme-surface-border max-h-40 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-theme-surface-secondary sticky top-0">
                <tr>
                  <th scope="col" className="text-theme-text-secondary px-3 py-1.5 text-left text-xs">
                    Name
                  </th>
                  <th scope="col" className="text-theme-text-secondary px-3 py-1.5 text-left text-xs">
                    Qty
                  </th>
                  <th scope="col" className="text-theme-text-secondary px-3 py-1.5 text-left text-xs">
                    Unit
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {parsed.map((line, idx) => (
                  <tr key={`${line.name}-${idx}`}>
                    <td className="text-theme-text-primary px-3 py-1.5">{line.name}</td>
                    <td className="text-theme-text-secondary px-3 py-1.5">{line.quantity ?? '—'}</td>
                    <td className="text-theme-text-secondary px-3 py-1.5">{line.unitOfMeasure ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default BulkAddItemsModal;
