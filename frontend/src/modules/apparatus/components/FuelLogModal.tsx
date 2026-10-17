/**
 * Fuel Log Modal
 *
 * Modal form for adding fuel log entries to an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
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

const inputClass = 'form-input px-3 focus:ring-red-500/50 focus:border-red-500';
const labelClass = 'form-label';
const selectClass = inputClass;

export const FuelLogModal: React.FC<FuelLogModalProps> = ({ isOpen, onClose, onSaved, apparatusId }) => {
  const tz = useTimezone();
  const [f, setF] = useState<FormData>(() => emptyForm(tz));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setF(emptyForm(tz));
    }
  }, [isOpen, tz]);

  const up = (k: keyof FormData, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

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
    if (!f.gallons || Number(f.gallons) <= 0) {
      toast.error('Enter gallons greater than 0');
      return;
    }
    if (!f.fuelDate) {
      toast.error('Select the fill-up date');
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
      toast.error(getErrorMessage(err, 'Failed to add fuel log'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Fuel Log"
      size="md"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : 'Add Fuel Log'}
          </button>
          <button
            type="button"
            onClick={onClose}
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
          <div>
            <label htmlFor="fuel-date" className={labelClass}>
              Date *
            </label>
            <input
              id="fuel-date"
              type="date"
              className={inputClass}
              value={f.fuelDate}
              onChange={(e) => up('fuelDate', e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="fuel-type" className={labelClass}>
              Fuel Type *
            </label>
            <select
              id="fuel-type"
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
          </div>
        </div>

        {/* Gallons, Price, Total */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="fuel-gallons" className={labelClass}>
              Gallons *
            </label>
            <input
              id="fuel-gallons"
              type="number"
              step="0.01"
              min="0"
              className={inputClass}
              value={f.gallons}
              onChange={(e) => handleGallonsChange(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="fuel-price" className={labelClass}>
              Price / Gallon ($)
            </label>
            <input
              id="fuel-price"
              type="number"
              step="0.001"
              min="0"
              className={inputClass}
              value={f.pricePerGallon}
              onChange={(e) => handlePriceChange(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="fuel-total" className={labelClass}>
              Total Cost ($)
            </label>
            <input
              id="fuel-total"
              type="number"
              step="0.01"
              min="0"
              className={inputClass}
              value={f.totalCost}
              onChange={(e) => up('totalCost', e.target.value)}
            />
          </div>
        </div>

        {/* Mileage & Hours */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fuel-mileage" className={labelClass}>
              Mileage at Fill
            </label>
            <input
              id="fuel-mileage"
              type="number"
              min="0"
              className={inputClass}
              value={f.mileageAtFill}
              onChange={(e) => up('mileageAtFill', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="fuel-hours" className={labelClass}>
              Engine Hours at Fill
            </label>
            <input
              id="fuel-hours"
              type="number"
              min="0"
              step="0.1"
              className={inputClass}
              value={f.hoursAtFill}
              onChange={(e) => up('hoursAtFill', e.target.value)}
            />
          </div>
        </div>

        {/* Full Tank */}
        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={f.isFullTank}
              onChange={(e) => up('isFullTank', e.target.checked)}
              className="border-theme-surface-border h-4 w-4 rounded text-red-600 focus:ring-red-500"
            />
            <span className="text-theme-text-secondary text-sm">Full tank fill-up</span>
          </label>
        </div>

        {/* Station */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="fuel-station-name" className={labelClass}>
              Station Name
            </label>
            <input
              id="fuel-station-name"
              type="text"
              className={inputClass}
              value={f.stationName}
              onChange={(e) => up('stationName', e.target.value)}
              placeholder="Fuel station name"
            />
          </div>
          <div>
            <label htmlFor="fuel-station-address" className={labelClass}>
              Station Address
            </label>
            <input
              id="fuel-station-address"
              type="text"
              className={inputClass}
              value={f.stationAddress}
              onChange={(e) => up('stationAddress', e.target.value)}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="fuel-notes" className={labelClass}>
            Notes
          </label>
          <textarea
            id="fuel-notes"
            className={inputClass}
            rows={2}
            value={f.notes}
            onChange={(e) => up('notes', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};

export default FuelLogModal;
