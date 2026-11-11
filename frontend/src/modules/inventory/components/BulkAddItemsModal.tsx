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
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '@/hooks/useFieldErrors';
import { inventoryService } from '@/services/inventoryService';
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

// A refusal against one pasted line names its place in the list
// (`entries.3.name`), which no single control matches, so it is written under
// the list; see the catch in `submit`.
const BULK_FIELDS: FieldSpecs<BulkField> = {
  list: { id: 'bulk-add-list', label: 'One item per line' },
  category: { id: 'bulk-add-category', label: 'Category', apiKeys: ['category_id'] },
  tracking: { id: 'bulk-add-tracking', label: 'Tracking', apiKeys: ['tracking_type'] },
};

/** How a refused line's field is named under the list. */
const LINE_FIELD_LABELS: Record<string, string> = {
  name: 'name',
  unit_of_measure: 'unit',
  quantity: 'quantity',
};

interface ValidationEntry {
  loc?: Array<string | number>;
  field?: string;
  message?: string;
  msg?: string;
}

/** The entries of a 422's `detail`, or none for any other failure. */
const validationDetail = (error: unknown): ValidationEntry[] => {
  const detail = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  return detail?.status === 422 && Array.isArray(detail.data?.detail) ? (detail.data.detail as ValidationEntry[]) : [];
};

const BulkAddItemsModal: React.FC<BulkAddItemsModalProps> = ({ isOpen, onClose, categories, onCreated }) => {
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [trackingType, setTrackingType] = useState<'pool' | 'individual'>('pool');
  const [saving, setSaving] = useState(false);
  const fieldErrors = useFieldErrors(BULK_FIELDS);
  const errors = fieldErrors.errors;
  // A pasted list is the officer's work; Escape, the X and Cancel ask before
  // throwing it away (forms review F-6).
  const isDirty = text !== '' || categoryId !== '' || trackingType !== 'pool';
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const parsed = useMemo(() => parseBulkLines(text), [text]);

  const reset = () => {
    setText('');
    setCategoryId('');
    setTrackingType('pool');
    fieldErrors.clear();
  };

  const clearError = (field: BulkField) => fieldErrors.setError(field, null);

  const showErrors = (next: FieldErrors<BulkField>) => {
    fieldErrors.setErrors(next);
    fieldErrors.focusFirst(next);
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // Checked here rather than by greying out Add, which told a member nothing
    // about why it would not press (forms review F-3).
    fieldErrors.setFormError(null);
    if (parsed.length === 0) {
      showErrors({ list: 'Paste or type at least one item name, one per line.' });
      return;
    }
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
      // The API answers per entry (`entries.3.name`), which the shared parser
      // reads only by its last segment; so each refusal is placed here: a line's
      // field is named under the list by its place in it, in the server's words.
      const placed = placeApiError(BULK_FIELDS, err);
      if (!placed) {
        // Anything else is said in the dialog, not in a toast behind it.
        fieldErrors.focusFirst(fieldErrors.setFromApiError(err, 'Failed to add the items'));
        return;
      }
      // Category and tracking are one value for the whole paste: the shared
      // parser already puts a refusal of either on its control.
      const lines: string[] = [];
      const unmatched: string[] = [];
      for (const entry of validationDetail(err)) {
        const path = entry.field ?? (entry.loc ?? []).filter((part) => part !== 'body').join('.');
        if (/(^|\.)(category_id|tracking_type)$/.test(path)) continue;
        const message = entry.message || entry.msg || 'Invalid value.';
        const line = /^entries\.(\d+)\.(\w+)$/.exec(path);
        if (line) {
          const label = LINE_FIELD_LABELS[line[2] ?? ''] ?? line[2] ?? 'value';
          lines.push(`Item ${String(Number(line[1]) + 1)}, ${label}: ${message}`);
        } else {
          unmatched.push(message);
        }
      }
      const next: FieldErrors<BulkField> = { ...placed.fieldErrors };
      if (lines.length > 0) next.list = lines.join(' ');
      showErrors(next);
      fieldErrors.setFormError(unmatched.length ? unmatched.join(' ') : null);
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
          disabled={saving}
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
        {fieldErrors.formError && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {fieldErrors.formError}
          </p>
        )}
        <FormField
          label="One item per line"
          required
          id={BULK_FIELDS.list.id}
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
          <FormField label="Category" id={BULK_FIELDS.category.id} error={errors.category}>
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
            id={BULK_FIELDS.tracking.id}
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
