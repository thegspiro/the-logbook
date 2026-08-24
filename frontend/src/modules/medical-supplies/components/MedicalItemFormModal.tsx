/**
 * MedicalItemFormModal — add or edit one medical supply.
 *
 * Deliberately shorter than the gear item form: a box of gauze has no size,
 * no style, no member assignment and no NFPA lifecycle. What it does have is
 * a count, a unit, and a floor to reorder at — dated stock arrives afterwards
 * as lots, through Receive delivery.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { InventoryCategory, InventoryItem } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import { formatNumber } from '../../../utils/dateFormatting';
import { Modal } from '../../../components/Modal';
import { MEDICAL_UNITS } from '../types';

interface MedicalItemFormModalProps {
  categories: InventoryCategory[];
  /** Omit to create. */
  item?: InventoryItem | undefined;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  category_id: string;
  description: string;
  manufacturer: string;
  quantity: string;
  unit_of_measure: string;
  reorder_point: string;
  storage_location: string;
  vendor: string;
}

function initialState(item?: InventoryItem): FormState {
  return {
    name: item?.name ?? '',
    category_id: item?.category_id ?? '',
    description: item?.description ?? '',
    manufacturer: item?.manufacturer ?? '',
    quantity: item?.quantity !== undefined ? String(item.quantity) : '',
    unit_of_measure: item?.unit_of_measure ?? 'each',
    reorder_point: item?.reorder_point !== undefined ? String(item.reorder_point) : '',
    storage_location: item?.storage_location ?? '',
    vendor: item?.vendor ?? '',
  };
}

export const MedicalItemFormModal: React.FC<MedicalItemFormModalProps> = ({ categories, item, onClose, onSaved }) => {
  const isEdit = Boolean(item);
  // A lot-stocked item's real count is the sum of its in-date lots. `quantity`
  // is a separate ledger that receiving a lot never touches, so this form must
  // neither show it as the count nor write to it.
  const isLotStocked = Boolean(item?.is_lot_stocked);
  const [form, setForm] = useState<FormState>(() => initialState(item));
  const [isSaving, setIsSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Give the supply a name');
      return;
    }
    if (!form.category_id) {
      toast.error('Pick a category — it is what files this as a medical supply');
      return;
    }

    setIsSaving(true);
    try {
      if (isEdit && item) {
        // Update: an emptied box means "clear this", so it must travel as an
        // explicit null. Omitting the key would leave the old value in place
        // behind a success toast. Every field the form owns is sent on every
        // save, for the same reason.
        await medicalSuppliesService.updateItem(item.id, {
          name: form.name.trim(),
          category_id: form.category_id,
          description: blankToNull(form.description),
          manufacturer: blankToNull(form.manufacturer),
          ...(isLotStocked ? {} : { quantity: numberOrNull(form.quantity) }),
          unit_of_measure: blankToNull(form.unit_of_measure),
          reorder_point: numberOrNull(form.reorder_point),
          storage_location: blankToNull(form.storage_location),
          vendor: blankToNull(form.vendor),
        });
        toast.success('Supply updated');
      } else {
        // Create: `|| undefined` so a blank box is omitted rather than sent as
        // an empty string, which the Pydantic validators reject with a 422.
        await medicalSuppliesService.createItem({
          name: form.name.trim(),
          category_id: form.category_id,
          description: form.description.trim() || undefined,
          manufacturer: form.manufacturer.trim() || undefined,
          quantity: form.quantity === '' ? undefined : Number(form.quantity),
          unit_of_measure: form.unit_of_measure.trim() || undefined,
          reorder_point: form.reorder_point === '' ? undefined : Number(form.reorder_point),
          storage_location: form.storage_location.trim() || undefined,
          vendor: form.vendor.trim() || undefined,
          // Medical stock is counted, not issued one-to-one to a member.
          tracking_type: 'pool',
        });
        toast.success('Supply added');
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, isEdit ? 'Failed to update supply' : 'Failed to add supply'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit medical supply' : 'Add medical supply'} size="lg">
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="modal-body space-y-4">
          {categories.length === 0 && (
            <div className="alert-warning">
              No medical supply categories exist yet. Create one first — a supply is filed as medical by its category.
            </div>
          )}

          <div>
            <label htmlFor="ms-name" className="form-label">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="ms-name"
              className="form-input w-full"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. 4x4 Gauze Pads"
              required
            />
          </div>

          <div>
            <label htmlFor="ms-category" className="form-label">
              Category <span aria-hidden="true">*</span>
            </label>
            <select
              id="ms-category"
              className="form-input w-full"
              value={form.category_id}
              onChange={(e) => set('category_id', e.target.value)}
              required
            >
              <option value="">Select a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="ms-qty" className="form-label">
                On hand
              </label>
              {isLotStocked ? (
                // The count for a lot-stocked item lives in its lots, and this
                // field writes `quantity` — a separate ledger the page never
                // displays for such an item. Editing it would change nothing
                // visible behind a success toast, so the field states where the
                // real number comes from instead of pretending to own it.
                <p className="text-theme-text-muted border-theme-surface-border rounded-md border border-dashed px-3 py-2 text-sm">
                  {formatNumber(item?.lot_stock ?? 0)} from stock lots — adjust by receiving a delivery or editing the
                  item&apos;s lots.
                </p>
              ) : (
                <input
                  id="ms-qty"
                  type="number"
                  min="0"
                  className="form-input w-full"
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                />
              )}
            </div>
            <div>
              <label htmlFor="ms-unit" className="form-label">
                Unit
              </label>
              <input
                id="ms-unit"
                list="ms-unit-options"
                className="form-input w-full"
                value={form.unit_of_measure}
                onChange={(e) => set('unit_of_measure', e.target.value)}
              />
              <datalist id="ms-unit-options">
                {MEDICAL_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="ms-reorder" className="form-label">
                Reorder at
              </label>
              <input
                id="ms-reorder"
                type="number"
                min="0"
                className="form-input w-full"
                value={form.reorder_point}
                onChange={(e) => set('reorder_point', e.target.value)}
                placeholder="Alert below this"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ms-manufacturer" className="form-label">
                Manufacturer
              </label>
              <input
                id="ms-manufacturer"
                className="form-input w-full"
                value={form.manufacturer}
                onChange={(e) => set('manufacturer', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ms-vendor" className="form-label">
                Vendor
              </label>
              <input
                id="ms-vendor"
                className="form-input w-full"
                value={form.vendor}
                onChange={(e) => set('vendor', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="ms-storage" className="form-label">
              Storage location
            </label>
            <input
              id="ms-storage"
              className="form-input w-full"
              value={form.storage_location}
              onChange={(e) => set('storage_location', e.target.value)}
              placeholder="e.g. EMS Room, Shelf B-3"
            />
          </div>

          <div>
            <label htmlFor="ms-description" className="form-label">
              Notes
            </label>
            <textarea
              id="ms-description"
              className="form-input w-full"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </div>

        <div className="border-theme-surface-border flex justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving || categories.length === 0}>
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add supply'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default MedicalItemFormModal;
