/**
 * Fuel Log Modal
 *
 * Modal form for adding fuel log entries to an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { getTodayLocalDate, localToUTC } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { apparatusFuelLogService } from '../services/api';
import type { ApparatusFuelLogCreate, FuelType } from '../types';

interface FuelLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  apparatusId: string;
}

interface FormData {
  fuelDate: string;
  fuelType: FuelType;
  gallons: string;
  pricePerGallon: string;
  totalCost: string;
  mileageAtFill: string;
  hoursAtFill: string;
  isFullTank: boolean;
  stationName: string;
  stationAddress: string;
  notes: string;
}

// Built per open rather than once at module load: a constant froze "today" at
// the day the bundle loaded, and it must be today in the department's zone.
const emptyForm = (tz: string): FormData => ({
  fuelDate: getTodayLocalDate(tz),
  fuelType: 'diesel',
  gallons: '',
  pricePerGallon: '',
  totalCost: '',
  mileageAtFill: '',
  hoursAtFill: '',
  isFullTank: true,
  stationName: '',
  stationAddress: '',
  notes: '',
});

const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'diesel', label: 'Diesel' },
  { value: 'gasoline', label: 'Gasoline' },
  { value: 'electric', label: 'Electric' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'propane', label: 'Propane' },
  { value: 'cng', label: 'CNG' },
  { value: 'other', label: 'Other' },
];

type FuelField =
  | 'fuelDate'
  | 'fuelType'
  | 'gallons'
  | 'pricePerGallon'
  | 'totalCost'
  | 'mileageAtFill'
  | 'hoursAtFill'
  | 'stationName'
  | 'stationAddress'
  | 'notes';

/** How the fuel-log endpoint's field names land on this dialog (forms review F-2). */
const FUEL_FIELDS: Record<FuelField, ServerFieldSpec> = {
  fuelDate: { label: 'Date' },
  fuelType: { label: 'Fuel type' },
  gallons: { label: 'Gallons' },
  pricePerGallon: { label: 'Price per gallon' },
  totalCost: { label: 'Total cost' },
  mileageAtFill: { label: 'Mileage at fill' },
  hoursAtFill: { label: 'Engine hours at fill' },
  // `ApparatusFuelLogBase.station_name` max_length.
  stationName: { label: 'Station name', maxLength: 200 },
  stationAddress: { label: 'Station address' },
  notes: { label: 'Notes' },
};

/** Field order on screen, and each control's id, so the first refusal takes focus. */
const FUEL_FIELD_IDS: Record<FuelField, string> = {
  fuelDate: 'fuel-date',
  fuelType: 'fuel-type',
  gallons: 'fuel-gallons',
  pricePerGallon: 'fuel-price',
  totalCost: 'fuel-total',
  mileageAtFill: 'fuel-mileage',
  hoursAtFill: 'fuel-hours',
  stationName: 'fuel-station-name',
  stationAddress: 'fuel-station-address',
  notes: 'fuel-notes',
};

const inputClass = 'form-input px-3 focus:ring-red-500/50 focus:border-red-500';
const selectClass = inputClass;

export const FuelLogModal: React.FC<FuelLogModalProps> = ({ isOpen, onClose, onSaved, apparatusId }) => {
  const tz = useTimezone();
  const [f, setF] = useState<FormData>(() => emptyForm(tz));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FuelField, string>>>({});
  // What the form held when it opened, so Escape, the X and Cancel can ask
  // before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const isDirty = baseline !== '' && JSON.stringify(f) !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    if (isOpen) {
      const seeded = emptyForm(tz);
      setF(seeded);
      setBaseline(JSON.stringify(seeded));
      setErrors({});
    }
  }, [isOpen, tz]);

  const up = (k: keyof FormData, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k in FUEL_FIELDS) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<FuelField, string>>) => {
    setErrors(next);
    const first = (Object.keys(FUEL_FIELD_IDS) as FuelField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(FUEL_FIELD_IDS[first])?.focus(), 0);
  };

  const handleGallonsChange = (gallons: string) => {
    up('gallons', gallons);
    if (gallons && f.pricePerGallon) {
      setF((p) => ({ ...p, gallons, totalCost: (Number(gallons) * Number(p.pricePerGallon)).toFixed(2) }));
    }
  };

  const handlePriceChange = (price: string) => {
    up('pricePerGallon', price);
    if (f.gallons && price) {
      setF((p) => ({ ...p, pricePerGallon: price, totalCost: (Number(p.gallons) * Number(price)).toFixed(2) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<FuelField, string>> = {};
    if (!f.fuelDate) missing.fuelDate = 'Select the fill-up date.';
    if (!f.gallons || Number(f.gallons) <= 0) missing.gallons = 'Enter gallons greater than 0.';
    if (Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }

    setSaving(true);
    try {
      const payload: ApparatusFuelLogCreate = {
        apparatusId,
        // fuel_date is a datetime column read back through formatDate in the
        // department's zone. A bare date is stored as midnight UTC, which is
        // the previous evening west of Greenwich; local noon stays on the
        // chosen day in every zone.
        fuelDate: localToUTC(`${f.fuelDate}T12:00`, tz),
        fuelType: f.fuelType,
        gallons: Number(f.gallons),
        ...(f.pricePerGallon ? { pricePerGallon: Number(f.pricePerGallon) } : {}),
        ...(f.totalCost ? { totalCost: Number(f.totalCost) } : {}),
        ...(f.mileageAtFill ? { mileageAtFill: Number(f.mileageAtFill) } : {}),
        ...(f.hoursAtFill ? { hoursAtFill: Number(f.hoursAtFill) } : {}),
        isFullTank: f.isFullTank,
        ...(f.stationName ? { stationName: f.stationName } : {}),
        ...(f.stationAddress ? { stationAddress: f.stationAddress } : {}),
        ...(f.notes ? { notes: f.notes } : {}),
      };

      await apparatusFuelLogService.createFuelLog(payload);
      toast.success('Fuel log added');
      onSaved();
      onClose();
    } catch (err) {
      // A refused field is flagged on that field rather than named in a toast (forms review F-2).
      const mapped = mapServerFieldErrors(err, FUEL_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to add fuel log'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Add Fuel Log"
      size="md"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : 'Add Fuel Log'}
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
        {/* Date & Type */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Date" required error={errors.fuelDate} id={FUEL_FIELD_IDS.fuelDate}>
            {(field) => (
              <input
                {...field}
                type="date"
                className={inputClass}
                value={f.fuelDate}
                onChange={(e) => up('fuelDate', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Fuel Type" required error={errors.fuelType} id={FUEL_FIELD_IDS.fuelType}>
            {(field) => (
              <select
                {...field}
                className={selectClass}
                value={f.fuelType}
                onChange={(e) => up('fuelType', e.target.value)}
              >
                {FUEL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>

        {/* Gallons, Price, Total */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Gallons" required error={errors.gallons} id={FUEL_FIELD_IDS.gallons}>
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className={inputClass}
                value={f.gallons}
                onChange={(e) => handleGallonsChange(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Price / Gallon ($)" error={errors.pricePerGallon} id={FUEL_FIELD_IDS.pricePerGallon}>
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                className={inputClass}
                value={f.pricePerGallon}
                onChange={(e) => handlePriceChange(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Total Cost ($)" error={errors.totalCost} id={FUEL_FIELD_IDS.totalCost}>
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className={inputClass}
                value={f.totalCost}
                onChange={(e) => up('totalCost', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Mileage & Hours */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Mileage at Fill" error={errors.mileageAtFill} id={FUEL_FIELD_IDS.mileageAtFill}>
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="numeric"
                min="0"
                className={inputClass}
                value={f.mileageAtFill}
                onChange={(e) => up('mileageAtFill', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Engine Hours at Fill" error={errors.hoursAtFill} id={FUEL_FIELD_IDS.hoursAtFill}>
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                className={inputClass}
                value={f.hoursAtFill}
                onChange={(e) => up('hoursAtFill', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Full Tank */}
        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={f.isFullTank}
              onChange={(e) => up('isFullTank', e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Full tank fill-up</span>
          </label>
        </div>

        {/* Station */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Station Name"
            error={errors.stationName}
            id={FUEL_FIELD_IDS.stationName}
            maxLength={FUEL_FIELDS.stationName.maxLength}
            count={f.stationName.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                className={inputClass}
                value={f.stationName}
                onChange={(e) => up('stationName', e.target.value)}
                placeholder="Fuel station name"
              />
            )}
          </FormField>
          <FormField label="Station Address" error={errors.stationAddress} id={FUEL_FIELD_IDS.stationAddress}>
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                className={inputClass}
                value={f.stationAddress}
                onChange={(e) => up('stationAddress', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Notes */}
        <FormField label="Notes" error={errors.notes} id={FUEL_FIELD_IDS.notes}>
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

export default FuelLogModal;
