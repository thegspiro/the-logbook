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
import { medicalSuppliesService, type MedicalItemUpdate } from '../../../services/medicalSuppliesService';
import type { InventoryCategory, InventoryItem } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull, formatNameList, numberOrNull, parseNameList } from '../../../utils/formValues';
import { formatNumber } from '../../../utils/dateFormatting';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
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
  /**
   * An edit saved everything but a refused field, and the dialog stays open
   * with it flagged: refresh what is behind it without closing it.
   */
  onSavedExcept?: (() => void) | undefined;
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
  /** Carried on the apparatus only; there is no shelf stock to count or file. */
  apparatus_only: boolean;
  /** The room and the storage area within it; the free text is a note beside them. */
  location_id: string;
  storage_area_id: string;
  storage_location: string;
  vendor: string;
}

type MedicalField = Exclude<keyof FormState, 'apparatus_only'>;

/**
 * How the medical item endpoints' field names land on this dialog (forms
 * review F-2), in screen order, with the ids the dialog has always used so
 * labels, tests and focus keep their targets.
 */
const SUPPLY_FIELDS: FieldSpecs<MedicalField> = {
  name: { id: 'ms-name', label: 'Name' },
  also_called: { id: 'ms-also-called', label: 'Also called' },
  category_id: { id: 'ms-category', label: 'Category' },
  size: { id: 'ms-size', label: 'Size' },
  quantity: { id: 'ms-qty', label: 'On hand' },
  unit_of_measure: { id: 'ms-unit', label: 'Unit' },
  reorder_point: { id: 'ms-reorder', label: 'Reorder at' },
  manufacturer: { id: 'ms-manufacturer', label: 'Manufacturer' },
  vendor: { id: 'ms-vendor', label: 'Vendor' },
  location_id: { id: 'ms-room', label: 'Room' },
  storage_area_id: { id: 'ms-area', label: 'Storage area' },
  storage_location: { id: 'ms-storage', label: 'Storage note' },
  description: { id: 'ms-description', label: 'Notes' },
};

/**
 * The max_length of `InventoryItemCreate` / `InventoryItemUpdate`, which both
 * endpoints take (forms review F-2).
 */
const MEDICAL_LIMITS = {
  name: 255,
  size: 50,
  unit_of_measure: 50,
  manufacturer: 255,
  vendor: 255,
  storage_location: 255,
  description: 2000,
} as const;

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
    apparatus_only: Boolean(item?.apparatus_only),
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
  onSavedExcept,
}) => {
  const isEdit = Boolean(item);
  // A lot-stocked item's real count is the sum of its in-date lots. `quantity`
  // is a separate ledger that receiving a lot never touches, so this form must
  // neither show it as the count nor write to it.
  const isLotStocked = Boolean(item?.is_lot_stocked);
  const [form, setForm] = useState<FormState>(() => initialState(item));
  const [isSaving, setIsSaving] = useState(false);
  // What the form held when it opened (or last saved), so Escape, the X and
  // Cancel can ask before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialState(item)));
  const isDirty = JSON.stringify(form) !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const fieldErrors = useFieldErrors(SUPPLY_FIELDS);
  const errors = fieldErrors.errors;
  const clearError = (key: MedicalField) => fieldErrors.setError(key, null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key !== 'apparatus_only') clearError(key);
  };

  const showErrors = (next: FieldErrors<MedicalField>) => {
    fieldErrors.setErrors(next);
    fieldErrors.focusFirst(next);
  };

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
        const fillRoom = (f: FormState): FormState => {
          if (f.location_id || !f.storage_area_id) return f;
          const room = options.areas.find((a) => a.id === f.storage_area_id)?.location_id;
          return room ? { ...f, location_id: room } : f;
        };
        setForm(fillRoom);
        // Filled in by the form, not the officer, so it is not a change to ask about.
        setBaseline((b) => JSON.stringify(fillRoom(JSON.parse(b) as FormState)));
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

  const chooseRoom = (roomId: string) => {
    clearError('location_id');
    setForm((f) => {
      const area = storage?.areas.find((a) => a.id === f.storage_area_id);
      // An area in another room cannot stay chosen once the room changes.
      const keepArea = !roomId || !area || area.location_id === roomId;
      return { ...f, location_id: roomId, storage_area_id: keepArea ? f.storage_area_id : '' };
    });
  };
  const chooseArea = (areaId: string) => {
    clearError('storage_area_id');
    setForm((f) => {
      const area = storage?.areas.find((a) => a.id === areaId);
      // An area sits in one room; picking it settles the room as well.
      return { ...f, storage_area_id: areaId, location_id: area?.location_id ?? f.location_id };
    });
  };

  /**
   * After an edit that wrote everything but `refused`: the list is refreshed
   * behind the dialog, which stays open with those fields flagged, and only
   * they count as unsaved. onSaved is not called — it closes the dialog.
   */
  const keepRefused = (refused: FieldErrors<MedicalField>) => {
    showErrors(refused);
    const stored = JSON.parse(baseline) as FormState;
    const keys = Object.keys(refused) as MedicalField[];
    setBaseline(JSON.stringify({ ...form, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) }));
    const first = (Object.keys(SUPPLY_FIELDS) as MedicalField[]).find((k) => refused[k]);
    if (first) {
      toast.error(
        `Supply saved, except ${SUPPLY_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Checked here rather than by greying out Add supply, which told an
    // officer nothing about why it would not press (forms review F-3).
    const missing: FieldErrors<MedicalField> = {};
    if (!form.name.trim()) missing.name = 'Give the supply a name.';
    if (!form.category_id) {
      missing.category_id =
        categories.length === 0
          ? 'Add a medical supply category first — the notice above links to the page.'
          : 'Choose a category — it is what makes this a medical supply.';
    }
    fieldErrors.setFormError(null);
    // A new supply is not created until every field is fixed; an edit saves
    // the rest and keeps the stored value of a refused one (below).
    if (!isEdit && Object.keys(missing).length > 0) {
      showErrors(missing);
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
        const payload: MedicalItemUpdate = {
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
          apparatus_only: form.apparatus_only,
          location_id: blankToNull(form.location_id),
          storage_area_id: blankToNull(form.storage_area_id),
          storage_location: blankToNull(form.storage_location),
          vendor: blankToNull(form.vendor),
        };
        // Single-save rule (owner, 2026-11-05): a value the record cannot hold
        // is not written — its key is left out, which the backend reads as
        // "leave alone", so the stored value is kept — the rest saves, and the
        // field stays flagged until it is fixed.
        let refused: FieldErrors<MedicalField> = missing;
        const send = (skip: FieldErrors<MedicalField>) => {
          const rest: Record<string, unknown> = { ...payload };
          for (const key of Object.keys(skip)) delete rest[key];
          return medicalSuppliesService.updateItem(item.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = placeApiError(SUPPLY_FIELDS, err);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          onSavedExcept?.();
          keepRefused(refused);
          return;
        }
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
          apparatus_only: form.apparatus_only,
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
      // A refused field is flagged on that field (forms review F-2); a new
      // supply is not created until it is fixed. Anything no field answers
      // for is said above the fields.
      fieldErrors.focusFirst(
        fieldErrors.setFromApiError(err, isEdit ? 'Failed to update supply' : 'Failed to add supply')
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={isEdit ? 'Edit medical supply' : 'Add medical supply'}
      size="lg"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Add supply'}
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

        {fieldErrors.formError && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {fieldErrors.formError}
          </p>
        )}
        <FormField
          label="Name"
          required
          error={errors.name}
          id={SUPPLY_FIELDS.name.id}
          maxLength={MEDICAL_LIMITS.name}
          count={form.name.length}
        >
          {(field) => (
            <input
              {...field}
              className="form-input w-full"
              placeholder="e.g. 4x4 Gauze Pads"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          )}
        </FormField>

        <FormField
          label="Also called"
          error={errors.also_called}
          id={SUPPLY_FIELDS.also_called.id}
          hint="Other names for this supply, separated by commas. Checklists use them to find it."
        >
          {(field) => (
            <input
              {...field}
              className="form-input w-full"
              placeholder="e.g. BVM, Ambu bag"
              value={form.also_called}
              onChange={(e) => set('also_called', e.target.value)}
            />
          )}
        </FormField>

        <FormField label="Category" required error={errors.category_id} id={SUPPLY_FIELDS.category_id.id}>
          {(field) => (
            <select
              {...field}
              className="form-input w-full"
              value={form.category_id}
              onChange={(e) => set('category_id', e.target.value)}
            >
              <option value="">Select a category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          label="Size"
          error={errors.size}
          id={SUPPLY_FIELDS.size.id}
          maxLength={MEDICAL_LIMITS.size}
          count={form.size.length}
        >
          {(field) => (
            <input
              {...field}
              className="form-input w-full"
              placeholder="e.g. Adult, Pediatric, Large"
              value={form.size}
              onChange={(e) => set('size', e.target.value)}
            />
          )}
        </FormField>

        <div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={form.apparatus_only}
              onChange={(e) => set('apparatus_only', e.target.checked)}
              aria-describedby="ms-apparatus-only-hint"
            />
            <span className="text-theme-text-primary font-medium">Kept on apparatus only</span>
          </label>
          <p id="ms-apparatus-only-hint" className="text-theme-text-muted mt-1 ml-6 text-xs">
            For equipment with no spare in a stock room, such as a LUCAS device. It is counted on the apparatus
            checklists, and judged low on what the trucks carry.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="On hand" error={errors.quantity} id={SUPPLY_FIELDS.quantity.id}>
            {(field) =>
              form.apparatus_only ? (
                // The shelf is not counted for this supply (the backend treats it
                // as 0), so a box here would edit a number nothing reads. The
                // stored value is left as it is, so unticking restores it.
                <p className="text-theme-text-muted border-theme-surface-border rounded-md border border-dashed px-3 py-2 text-sm">
                  Counted on the apparatus checklists.
                </p>
              ) : isLotStocked ? (
                // The count for a lot-stocked item lives in its lots, and this
                // field writes `quantity` — a separate ledger the page never
                // displays for such an item. Editing it would change nothing
                // visible behind a success toast, so the field states where the
                // real number comes from instead of pretending to own it.
                <p className="text-theme-text-muted border-theme-surface-border rounded-md border border-dashed px-3 py-2 text-sm">
                  {formatNumber(item?.lot_stock ?? 0)} from stock lots — adjust by receiving a delivery, or with the
                  Lots button on this supply&apos;s row.
                </p>
              ) : (
                <input
                  {...field}
                  inputMode="numeric"
                  type="number"
                  min="0"
                  className="form-input w-full"
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                />
              )
            }
          </FormField>
          <div>
            <FormField
              label="Unit"
              error={errors.unit_of_measure}
              id={SUPPLY_FIELDS.unit_of_measure.id}
              maxLength={MEDICAL_LIMITS.unit_of_measure}
              count={form.unit_of_measure.length}
            >
              {(field) => (
                <input
                  {...field}
                  className="form-input w-full"
                  list="ms-unit-options"
                  value={form.unit_of_measure}
                  onChange={(e) => set('unit_of_measure', e.target.value)}
                />
              )}
            </FormField>
            <datalist id="ms-unit-options">
              {MEDICAL_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <FormField label="Reorder at" error={errors.reorder_point} id={SUPPLY_FIELDS.reorder_point.id}>
            {(field) => (
              <input
                {...field}
                className="form-input w-full"
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="Flag as low at or below this"
                value={form.reorder_point}
                onChange={(e) => set('reorder_point', e.target.value)}
              />
            )}
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Manufacturer"
            error={errors.manufacturer}
            id={SUPPLY_FIELDS.manufacturer.id}
            maxLength={MEDICAL_LIMITS.manufacturer}
            count={form.manufacturer.length}
          >
            {(field) => (
              <input
                {...field}
                className="form-input w-full"
                value={form.manufacturer}
                onChange={(e) => set('manufacturer', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Vendor"
            error={errors.vendor}
            id={SUPPLY_FIELDS.vendor.id}
            maxLength={MEDICAL_LIMITS.vendor}
            count={form.vendor.length}
          >
            {(field) => (
              <input
                {...field}
                className="form-input w-full"
                value={form.vendor}
                onChange={(e) => set('vendor', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Hidden rather than cleared: the stored room and area stay as they
            were, so a supply ticked by mistake loses nothing when unticked. */}
        <fieldset className="space-y-3" hidden={form.apparatus_only}>
          <legend className="form-label">Where it is kept</legend>
          {storageError && (
            <p role="alert" className="alert-warning text-sm">
              The storage areas could not be loaded: {storageError} The note below still saves.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Room" error={errors.location_id} id={SUPPLY_FIELDS.location_id.id}>
              {(field) => (
                <select
                  {...field}
                  className="form-input w-full"
                  disabled={!storage}
                  value={form.location_id}
                  onChange={(e) => chooseRoom(e.target.value)}
                >
                  <option value="">No room</option>
                  {storage?.rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Storage area" error={errors.storage_area_id} id={SUPPLY_FIELDS.storage_area_id.id}>
              {(field) => (
                <select
                  {...field}
                  className="form-input w-full"
                  disabled={!storage}
                  value={form.storage_area_id}
                  onChange={(e) => chooseArea(e.target.value)}
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
              )}
            </FormField>
          </div>
          {storage && storage.areas.length === 0 && (
            <p className="text-theme-text-muted text-xs">
              No storage areas are set up yet. They are added under Inventory › Storage Areas.
            </p>
          )}
          <FormField
            label="Storage note"
            error={errors.storage_location}
            id={SUPPLY_FIELDS.storage_location.id}
            maxLength={MEDICAL_LIMITS.storage_location}
            count={form.storage_location.length}
          >
            {(field) => (
              <input
                {...field}
                className="form-input w-full"
                placeholder="e.g. top drawer, left side"
                value={form.storage_location}
                onChange={(e) => set('storage_location', e.target.value)}
              />
            )}
          </FormField>
        </fieldset>

        <FormField
          label="Notes"
          error={errors.description}
          id={SUPPLY_FIELDS.description.id}
          maxLength={MEDICAL_LIMITS.description}
          count={form.description.length}
        >
          {(field) => (
            <textarea
              {...field}
              className="form-input w-full"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};

export default MedicalItemFormModal;
