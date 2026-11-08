/**
 * Equipment Modal
 *
 * Modal form for adding and editing equipment assigned to an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import { apparatusEquipmentService } from '../services/api';
import type { ApparatusEquipment, ApparatusEquipmentCreate, ApparatusEquipmentUpdate } from '../types';

interface EquipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  apparatusId: string;
  editEquipment?: ApparatusEquipment | null;
}

interface FormData {
  name: string;
  description: string;
  quantity: string;
  locationOnApparatus: string;
  isMounted: boolean;
  isRequired: boolean;
  serialNumber: string;
  assetTag: string;
  isPresent: boolean;
  notes: string;
}

const EMPTY: FormData = {
  name: '',
  description: '',
  quantity: '1',
  locationOnApparatus: '',
  isMounted: false,
  isRequired: false,
  serialNumber: '',
  assetTag: '',
  isPresent: true,
  notes: '',
};

type EquipmentField =
  'name' | 'quantity' | 'description' | 'locationOnApparatus' | 'serialNumber' | 'assetTag' | 'notes';

/**
 * How the equipment endpoints' field names land on this dialog (forms review
 * F-2), in screen order. Lengths are `ApparatusEquipmentBase`'s max_length.
 */
const EQUIPMENT_FIELDS: Record<EquipmentField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 200 },
  quantity: { label: 'Quantity' },
  description: { label: 'Description' },
  locationOnApparatus: { label: 'Location on apparatus', maxLength: 200 },
  serialNumber: { label: 'Serial number', maxLength: 100 },
  assetTag: { label: 'Asset tag', maxLength: 50 },
  notes: { label: 'Notes' },
};

const IDS = Object.fromEntries(Object.keys(EQUIPMENT_FIELDS).map((k) => [k, `equipment-${k}`])) as Record<
  EquipmentField,
  string
>;

const inputClass = 'form-input px-3 focus:ring-red-500/50 focus:border-red-500';

export const EquipmentModal: React.FC<EquipmentModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  apparatusId,
  editEquipment,
}) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<EquipmentField, string>>>({});
  // What the form held when it opened (or last saved), so Escape, the X and
  // Cancel can ask before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const isDirty = baseline !== '' && JSON.stringify(f) !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    let seeded: FormData = EMPTY;
    if (editEquipment) {
      seeded = {
        name: editEquipment.name,
        description: editEquipment.description ?? '',
        quantity: String(editEquipment.quantity),
        locationOnApparatus: editEquipment.locationOnApparatus ?? '',
        isMounted: editEquipment.isMounted,
        isRequired: editEquipment.isRequired,
        serialNumber: editEquipment.serialNumber ?? '',
        assetTag: editEquipment.assetTag ?? '',
        isPresent: editEquipment.isPresent,
        notes: editEquipment.notes ?? '',
      };
    }
    setF(seeded);
    setBaseline(JSON.stringify(seeded));
    setErrors({});
  }, [editEquipment, isOpen]);

  const up = (k: keyof FormData, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k in EQUIPMENT_FIELDS) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<EquipmentField, string>>) => {
    setErrors(next);
    const first = (Object.keys(EQUIPMENT_FIELDS) as EquipmentField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(IDS[first])?.focus(), 0);
  };

  /** After a save that wrote everything but `refused`: flag those, and count only them as unsaved. */
  const keepRefused = (refused: Partial<Record<EquipmentField, string>>) => {
    showErrors(refused);
    const stored = JSON.parse(baseline) as FormData;
    const keys = Object.keys(refused) as EquipmentField[];
    setBaseline(JSON.stringify({ ...f, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) }));
    const first = (Object.keys(EQUIPMENT_FIELDS) as EquipmentField[]).find((k) => refused[k]);
    if (first)
      toast.error(
        `Equipment saved, except ${EQUIPMENT_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
      );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // quantity is NOT NULL, so an edit cannot clear it. A blank used to save
    // as 1, quietly replacing the stored count; it is refused and the stored
    // count kept instead.
    const editQuantity = numberOrNull(f.quantity);
    const missing: Partial<Record<EquipmentField, string>> = {};
    if (!f.name.trim()) missing.name = 'Enter an equipment name.';
    if (editEquipment && (editQuantity === null || editQuantity < 1))
      missing.quantity = 'Enter a quantity of at least 1.';
    // A new record is not created until every field is fixed; an edit saves
    // the rest and keeps the stored value of a refused one (below).
    if (!editEquipment && Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }

    setSaving(true);
    try {
      if (editEquipment) {
        // Every field the form owns, every save: the backend applies updates
        // with exclude_unset, so a blank left out of the payload would keep
        // the old value. A blank goes as null, which clears it.
        const payload: ApparatusEquipmentUpdate = {
          name: f.name.trim(),
          description: blankToNull(f.description),
          quantity: editQuantity ?? editEquipment.quantity,
          locationOnApparatus: blankToNull(f.locationOnApparatus),
          isMounted: f.isMounted,
          isRequired: f.isRequired,
          serialNumber: blankToNull(f.serialNumber),
          assetTag: blankToNull(f.assetTag),
          isPresent: f.isPresent,
          notes: blankToNull(f.notes),
        };
        // Single-save rule (owner, 2026-11-05): a value the record cannot hold
        // is not written — its key is left out, which the backend reads as
        // "leave alone", so the stored value is kept — the rest saves, and the
        // field stays flagged until it is fixed.
        let refused: Partial<Record<EquipmentField, string>> = missing;
        const send = (skip: Partial<Record<EquipmentField, string>>) => {
          const rest: Record<string, unknown> = { ...payload };
          for (const key of Object.keys(skip)) delete rest[key];
          return apparatusEquipmentService.updateEquipment(editEquipment.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = mapServerFieldErrors(err, EQUIPMENT_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          onSaved();
          keepRefused(refused);
          return;
        }
        toast.success('Equipment updated');
      } else {
        const payload: ApparatusEquipmentCreate = {
          apparatusId,
          name: f.name.trim(),
          quantity: Number(f.quantity) || 1,
          isMounted: f.isMounted,
          isRequired: f.isRequired,
          isPresent: f.isPresent,
          ...(f.description ? { description: f.description } : {}),
          ...(f.locationOnApparatus ? { locationOnApparatus: f.locationOnApparatus } : {}),
          ...(f.serialNumber ? { serialNumber: f.serialNumber } : {}),
          ...(f.assetTag ? { assetTag: f.assetTag } : {}),
          ...(f.notes ? { notes: f.notes } : {}),
        };
        await apparatusEquipmentService.createEquipment(payload);
        toast.success('Equipment added');
      }
      onSaved();
      onClose();
    } catch (err) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new record is not created until it is fixed.
      const mapped = mapServerFieldErrors(err, EQUIPMENT_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save equipment'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={editEquipment ? 'Edit Equipment' : 'Add Equipment'}
      size="md"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : editEquipment ? 'Save Changes' : 'Add Equipment'}
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Name & Quantity */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            label="Name"
            required
            error={errors.name}
            id={IDS.name}
            maxLength={EQUIPMENT_FIELDS.name.maxLength}
            count={f.name.length}
            className="sm:col-span-2"
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="text"
                placeholder="Equipment name"
                value={f.name}
                onChange={(e) => up('name', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Quantity" error={errors.quantity} id={IDS.quantity}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                inputMode="numeric"
                min="1"
                value={f.quantity}
                onChange={(e) => up('quantity', e.target.value)}
              />
            )}
          </FormField>
        </div>
        <FormField label="Description" error={errors.description} id={IDS.description}>
          {(field) => (
            <textarea
              {...field}
              className={inputClass}
              rows={2}
              value={f.description}
              onChange={(e) => up('description', e.target.value)}
            />
          )}
        </FormField>
        <FormField
          label="Location on Apparatus"
          error={errors.locationOnApparatus}
          id={IDS.locationOnApparatus}
          maxLength={EQUIPMENT_FIELDS.locationOnApparatus.maxLength}
          count={f.locationOnApparatus.length}
        >
          {(field) => (
            <input
              {...field}
              className={inputClass}
              type="text"
              placeholder="e.g. Compartment 3, Driver Side"
              value={f.locationOnApparatus}
              onChange={(e) => up('locationOnApparatus', e.target.value)}
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Serial Number"
            error={errors.serialNumber}
            id={IDS.serialNumber}
            maxLength={EQUIPMENT_FIELDS.serialNumber.maxLength}
            count={f.serialNumber.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="text"
                autoComplete="off"
                value={f.serialNumber}
                onChange={(e) => up('serialNumber', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Asset Tag"
            error={errors.assetTag}
            id={IDS.assetTag}
            maxLength={EQUIPMENT_FIELDS.assetTag.maxLength}
            count={f.assetTag.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="text"
                autoComplete="off"
                value={f.assetTag}
                onChange={(e) => up('assetTag', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-6">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={f.isRequired}
              onChange={(e) => up('isRequired', e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Required</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={f.isMounted}
              onChange={(e) => up('isMounted', e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Mounted</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={f.isPresent}
              onChange={(e) => up('isPresent', e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Present</span>
          </label>
        </div>
        <FormField label="Notes" error={errors.notes} id={IDS.notes}>
          {(field) => (
            <textarea
              {...field}
              className={inputClass}
              rows={2}
              value={f.notes}
              onChange={(e) => up('notes', e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};

export default EquipmentModal;
