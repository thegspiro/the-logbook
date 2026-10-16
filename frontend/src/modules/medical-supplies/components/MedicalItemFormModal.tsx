/**
 * MedicalItemFormModal — add or edit one medical supply.
 *
 * Deliberately shorter than the gear item form: no style, no member assignment
 * and no NFPA lifecycle. What it does have is a size where the supply comes in
 * several (adult and pediatric masks, airway sets), a count, a unit, and a
 * floor to reorder at — dated stock arrives afterwards as lots, through
 * Receive delivery.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { InventoryCategory, InventoryItem } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull, formatNameList, numberOrNull, parseNameList } from '../../../utils/formValues';
import { formatNumber } from '../../../utils/dateFormatting';
import { Modal } from '../../../components/Modal';
import { MEDICAL_UNITS } from '../types';
import type { MedicalStorageOptions } from '../types';

interface MedicalItemFormModalProps {
  categories: InventoryCategory[];
  /**
   * Why `categories` is empty, when it is empty because the list could not be
   * loaded. Without it this modal reads an empty array as "none have been
   * created yet" and tells the officer to create one -- advice that is wrong,
   * and that sends them to duplicate a category the department already has.
   * null when the list loaded.
   */
  categoriesError: string | null;
  /** Omit to create. */
  item?: InventoryItem | undefined;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  /** Comma-separated; becomes the supply's `also_called` list. */
  also_called: string;
  category_id: string;
  size: string;
  description: string;
  manufacturer: string;
  quantity: string;
  unit_of_measure: string;
  reorder_point: string;
  /** The room and the storage area within it; the free text is a note beside them. */
  location_id: string;
  storage_area_id: string;
  storage_location: string;
  vendor: string;
}

function initialState(item?: InventoryItem): FormState {
  return {
    name: item?.name ?? '',
    also_called: formatNameList(item?.also_called),
    category_id: item?.category_id ?? '',
    size: item?.size ?? '',
    description: item?.description ?? '',
    manufacturer: item?.manufacturer ?? '',
    quantity: item?.quantity != null ? String(item.quantity) : '',
    unit_of_measure: item?.unit_of_measure ?? 'each',
    // `!= null`, not `!== undefined`: the API sends an unset value as null,
    // which the strict check turned into the text "null" in the box.
    reorder_point: item?.reorder_point != null ? String(item.reorder_point) : '',
    location_id: item?.location_id ?? '',
    storage_area_id: item?.storage_area_id ?? '',
    storage_location: item?.storage_location ?? '',
    vendor: item?.vendor ?? '',
  };
}

export const MedicalItemFormModal: React.FC<MedicalItemFormModalProps> = ({
  categories,
  categoriesError,
  item,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(item);
  // A lot-stocked item's real count is the sum of its in-date lots. `quantity`
  // is a separate ledger that receiving a lot never touches, so this form must
  // neither show it as the count nor write to it.
  const isLotStocked = Boolean(item?.is_lot_stocked);
  const [form, setForm] = useState<FormState>(() => initialState(item));
  const [isSaving, setIsSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // The rooms and areas come from Inventory › Storage Areas. Read through the
  // medical route so a medical-only officer can file a supply too.
  const [storage, setStorage] = useState<MedicalStorageOptions | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    medicalSuppliesService
      .getStorageOptions()
      .then((options) => {
        if (cancelled) return;
        setStorage(options);
        // A supply filed on an area without a room (the automatic filing of
        // old free text sets only the area) shows the area's room, so the
        // room select does not read "No room" for a supply that has one.
        setForm((f) => {
          if (f.location_id || !f.storage_area_id) return f;
          const room = options.areas.find((a) => a.id === f.storage_area_id)?.location_id;
          return room ? { ...f, location_id: room } : f;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setStorageError(getErrorMessage(err, 'Failed to load storage areas'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const areaChoices = useMemo(() => {
    const areas = storage?.areas ?? [];
    return form.location_id ? areas.filter((a) => a.location_id === form.location_id) : areas;
  }, [storage, form.location_id]);
  // An item filed in an area since retired keeps it, and the select has to be
  // able to show it or it would read as unfiled.
  const currentAreaMissing =
    Boolean(form.storage_area_id) && storage != null && !storage.areas.some((a) => a.id === form.storage_area_id);

  const chooseRoom = (roomId: string) =>
    setForm((f) => {
      const area = storage?.areas.find((a) => a.id === f.storage_area_id);
      // An area in another room cannot stay chosen once the room changes.
      const keepArea = !roomId || !area || area.location_id === roomId;
      return { ...f, location_id: roomId, storage_area_id: keepArea ? f.storage_area_id : '' };
    });
  const chooseArea = (areaId: string) =>
    setForm((f) => {
      const area = storage?.areas.find((a) => a.id === areaId);
      // An area sits in one room; picking it settles the room as well.
      return { ...f, storage_area_id: areaId, location_id: area?.location_id ?? f.location_id };
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Give the supply a name');
      return;
    }
    if (!form.category_id) {
      toast.error('Choose a category — it is what makes this a medical supply');
      return;
    }

    setIsSaving(true);
    try {
      if (isEdit && item) {
        const quantity = numberOrNull(form.quantity);
        // Update: an emptied box means "clear this", so it must travel as an
        // explicit null. Omitting the key would leave the old value in place
        // behind a success toast. Every field the form owns is sent on every
        // save, for the same reason.
        await medicalSuppliesService.updateItem(item.id, {
          name: form.name.trim(),
          // Sent whole every save; `[]` is how the box being emptied clears it.
          also_called: parseNameList(form.also_called),
          category_id: form.category_id,
          size: blankToNull(form.size),
          description: blankToNull(form.description),
          manufacturer: blankToNull(form.manufacturer),
          // A blank count is omitted, not nulled: a pool item's quantity has
          // no cleared state (update_item refuses a null one), so an emptied
          // box keeps the stored count, as ItemFormModal does.
          ...(isLotStocked || quantity === null ? {} : { quantity }),
          unit_of_measure: blankToNull(form.unit_of_measure),
          reorder_point: numberOrNull(form.reorder_point),
          location_id: blankToNull(form.location_id),
          storage_area_id: blankToNull(form.storage_area_id),
          storage_location: blankToNull(form.storage_location),
          vendor: blankToNull(form.vendor),
        });
        toast.success('Supply updated');
      } else {
        // Create: `|| undefined` so a blank box is omitted rather than sent as
        // an empty string, which the Pydantic validators reject with a 422.
        await medicalSuppliesService.createItem({
          name: form.name.trim(),
          also_called: parseNameList(form.also_called).length ? parseNameList(form.also_called) : undefined,
          category_id: form.category_id,
          size: form.size.trim() || undefined,
          description: form.description.trim() || undefined,
          manufacturer: form.manufacturer.trim() || undefined,
          // 0, not omitted: the shared create schema defaults a missing
          // quantity to 1, so a supply added with a blank box showed one unit
          // on hand that nobody had received.
          quantity: form.quantity === '' ? 0 : Number(form.quantity),
          unit_of_measure: form.unit_of_measure.trim() || undefined,
          reorder_point: form.reorder_point === '' ? undefined : Number(form.reorder_point),
          location_id: form.location_id || undefined,
          storage_area_id: form.storage_area_id || undefined,
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
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit medical supply' : 'Add medical supply'}
      size="lg"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={isSaving || categories.length === 0}>
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add supply'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/*
         * A failed category load is reported whether or not options survived
         * it. With options retained the list is not empty, but it is out of
         * date: a category another session just created is missing, and one
         * that was deleted is still offered -- selectable right up to the
         * save that rejects it.
         */}
        {categoriesError && categories.length === 0 ? (
          <div className="alert-danger">
            The category list could not be loaded: {categoriesError} Close this and select Retry on the All supplies
            tab.
          </div>
        ) : categoriesError ? (
          <div className="alert-warning">
            Showing previously loaded categories — the list could not be refreshed: {categoriesError} New categories may
            be missing, and removed ones may still be listed.
          </div>
        ) : categories.length === 0 ? (
          <div className="alert-warning">
            No medical supply categories exist yet. Add one on the{' '}
            <Link to="/medical-supplies/categories" className="underline">
              Medical Supply Categories
            </Link>{' '}
            page first — a supply&apos;s category is what makes it medical.
          </div>
        ) : null}

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
          <label htmlFor="ms-also-called" className="form-label">
            Also called
          </label>
          <input
            id="ms-also-called"
            className="form-input w-full"
            value={form.also_called}
            onChange={(e) => set('also_called', e.target.value)}
            placeholder="e.g. BVM, Ambu bag"
            aria-describedby="ms-also-called-help"
          />
          <p id="ms-also-called-help" className="text-theme-text-muted mt-1 text-xs">
            Other names for this supply, separated by commas. Checklists use them to find it.
          </p>
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

        <div>
          <label htmlFor="ms-size" className="form-label">
            Size
          </label>
          <input
            id="ms-size"
            className="form-input w-full"
            value={form.size}
            maxLength={50}
            onChange={(e) => set('size', e.target.value)}
            placeholder="e.g. Adult, Pediatric, Large"
          />
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
                {formatNumber(item?.lot_stock ?? 0)} from stock lots — adjust by receiving a delivery, or with the Lots
                button on this supply&apos;s row.
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
              placeholder="Flag as low at or below this"
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

        <fieldset className="space-y-3">
          <legend className="form-label">Where it is kept</legend>
          {storageError && (
            <p role="alert" className="alert-warning text-sm">
              The storage areas could not be loaded: {storageError} The note below still saves.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ms-room" className="form-label">
                Room
              </label>
              <select
                id="ms-room"
                className="form-input w-full"
                value={form.location_id}
                onChange={(e) => chooseRoom(e.target.value)}
                disabled={!storage}
              >
                <option value="">No room</option>
                {storage?.rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ms-area" className="form-label">
                Storage area
              </label>
              <select
                id="ms-area"
                className="form-input w-full"
                value={form.storage_area_id}
                onChange={(e) => chooseArea(e.target.value)}
                disabled={!storage}
              >
                <option value="">No storage area</option>
                {currentAreaMissing && (
                  <option value={form.storage_area_id}>{item?.storage_path ?? 'Current area'} (retired)</option>
                )}
                {areaChoices.map((area) => (
                  <option key={area.id} value={area.id}>
                    {form.location_id || !area.location_name ? area.path : `${area.location_name} › ${area.path}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {storage && storage.areas.length === 0 && (
            <p className="text-theme-text-muted text-xs">
              No storage areas are set up yet. They are added under Inventory › Storage Areas.
            </p>
          )}
          <div>
            <label htmlFor="ms-storage" className="form-label">
              Storage note
            </label>
            <input
              id="ms-storage"
              className="form-input w-full"
              value={form.storage_location}
              onChange={(e) => set('storage_location', e.target.value)}
              placeholder="e.g. top drawer, left side"
            />
          </div>
        </fieldset>

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
    </Modal>
  );
};

export default MedicalItemFormModal;
