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
import { FormField } from '@/components/ux/FormField';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { friendlyFieldMessage, mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import { inventoryService } from '@/services/inventoryService';
import { getErrorMessage } from '@/utils/errorHandling';
import type { InventoryCategory, InventoryItemBulkEntry } from '@/services/api';
import { parseBulkLines } from '../utils/bulkItemLines';

interface BulkAddItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: InventoryCategory[];
  /** Fired after a successful write so the list behind can refresh. */
  /** Receives the ids of the items actually created (not the skipped ones). */
  onCreated: (createdIds: string[]) => void;
}

/** `InventoryItemBulkEntry`: `EntityName` and `unit_of_measure` max_lengths. */
const NAME_MAX = 255;
const UNIT_MAX = 50;

type BulkField = 'list' | 'category' | 'tracking';

const BULK_FIELD_IDS: Record<BulkField, string> = {
  list: 'bulk-add-list',
  category: 'bulk-add-category',
  tracking: 'bulk-add-tracking',
};

const BulkAddItemsModal: React.FC<BulkAddItemsModalProps> = ({ isOpen, onClose, categories, onCreated }) => {
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [trackingType, setTrackingType] = useState<'pool' | 'individual'>('pool');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<BulkField, string>>>({});
  // A pasted list is the officer's work; Escape, the X and Cancel ask before
  // throwing it away (forms review F-6).
  const isDirty = text !== '' || categoryId !== '' || trackingType !== 'pool';
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const parsed = useMemo(() => parseBulkLines(text), [text]);

  const reset = () => {
    setText('');
    setCategoryId('');
    setTrackingType('pool');
    setErrors({});
  };

  const clearError = (field: BulkField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  const showErrors = (next: Partial<Record<BulkField, string>>) => {
    setErrors(next);
    const first = (Object.keys(BULK_FIELD_IDS) as BulkField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(BULK_FIELD_IDS[first])?.focus(), 0);
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (parsed.length === 0) return;
    // A create: nothing is added until every line fits, so a too-long line is
    // named here rather than refused for the whole paste by the server.
    const tooLong = parsed.findIndex(
      (line) => line.name.length > NAME_MAX || (line.unitOfMeasure?.length ?? 0) > UNIT_MAX
    );
    if (tooLong >= 0) {
      const line = parsed[tooLong];
      const what =
        line && line.name.length > NAME_MAX ? `the name is over ${NAME_MAX}` : `the unit is over ${UNIT_MAX}`;
      showErrors({ list: `Item ${String(tooLong + 1)}: ${what} characters. Shorten it and add again.` });
      return;
    }
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
      onCreated(result.item_ids.map(String));
      reset();
      onClose();
    } catch (err: unknown) {
      // The API answers per entry (`entries.3.name`); a refused line is named
      // under the list, by its place in it, rather than as an API path.
      const specs: Record<string, ServerFieldSpec> = {
        category: { label: 'Category', api: parsed.map((_, i) => `entries.${String(i)}.category_id`) },
      };
      const lineSpecs: Record<string, { index: number; spec: ServerFieldSpec }> = {};
      parsed.forEach((_, i) => {
        const at = `entries.${String(i)}`;
        for (const [field, spec] of [
          ['name', { label: 'Name', maxLength: NAME_MAX }],
          ['unit_of_measure', { label: 'Unit', maxLength: UNIT_MAX }],
          ['quantity', { label: 'Quantity' }],
          ['tracking_type', { label: 'Tracking' }],
        ] as const) {
          const key = `${String(i)}:${field}`;
          specs[key] = { ...spec, api: `${at}.${field}` };
          lineSpecs[key] = { index: i, spec };
        }
      });
      const mapped = mapServerFieldErrors(err, specs);
      const refusedLines = Object.entries(mapped?.fieldErrors ?? {}).filter(
        ([key, message]) => key in lineSpecs && Boolean(message)
      );
      const next: Partial<Record<BulkField, string>> = {};
      if (mapped?.fieldErrors.category) next.category = mapped.fieldErrors.category;
      if (refusedLines.length > 0) {
        next.list = refusedLines
          .map(([key, message]) => {
            const { index, spec } = lineSpecs[key] ?? { index: 0, spec: { label: 'Item' } };
            return `Item ${String(index + 1)}: ${friendlyFieldMessage(message ?? '', spec)}`;
          })
          .join(' ');
      }
      if (Object.keys(next).length > 0) {
        showErrors(next);
        toast.error(mapped?.unmatched.join(' ') || 'Fix the fields marked below, then add again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to add the items'));
      }
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
          onClick={requestClose}
          className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary rounded-md border px-4 py-2 text-sm"
        >
          <X className="mr-1 inline h-3.5 w-3.5" />
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || parsed.length === 0}
          className="flex items-center gap-1.5 rounded-md bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
          Add {parsed.length || ''} item{parsed.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Add several items"
      size="lg"
      footer={footer}
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <div className="space-y-4">
        <FormField
          label="One item per line"
          required
          id={BULK_FIELD_IDS.list}
          error={errors.list}
          hint={
            <>
              Add <code className="font-mono">| quantity | unit</code> after a name to set those too. Names already in
              your inventory are skipped.
            </>
          }
        >
          {(field) => (
            <textarea
              {...field}
              className="form-input font-mono text-sm"
              rows={10}
              placeholder={'Gauze Pads, 4x4 Sterile\nNitrile Gloves, Large\nOropharyngeal Airway Set | 2 | Set'}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                clearError('list');
              }}
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Category" id={BULK_FIELD_IDS.category} error={errors.category}>
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  clearError('category');
                }}
              >
                <option value="">No category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            label="Tracking"
            id={BULK_FIELD_IDS.tracking}
            error={errors.tracking}
            hint="Counted is right for anything a checklist counts — a bracket holds four gauze, not gauze #7."
          >
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={trackingType}
                onChange={(e) => setTrackingType(e.target.value === 'individual' ? 'individual' : 'pool')}
              >
                <option value="pool">Counted (consumables, supplies)</option>
                <option value="individual">Serialized (one record per unit)</option>
              </select>
            )}
          </FormField>
        </div>

        {parsed.length > 0 && (
          <div className="border-theme-surface-border max-h-40 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-theme-surface-modal sticky top-0">
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
