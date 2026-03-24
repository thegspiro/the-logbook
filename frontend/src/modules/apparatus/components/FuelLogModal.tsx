/**
 * Fuel Log Modal
 *
 * Modal form for adding fuel log entries to an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
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

const EMPTY: FormData = {
  fuelDate: new Date().toISOString().split('T')[0] ?? '',
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
};

const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'diesel', label: 'Diesel' },
  { value: 'gasoline', label: 'Gasoline' },
  { value: 'electric', label: 'Electric' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'propane', label: 'Propane' },
  { value: 'cng', label: 'CNG' },
  { value: 'other', label: 'Other' },
];

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';
const selectClass = inputClass;

export const FuelLogModal: React.FC<FuelLogModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  apparatusId,
}) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setF(EMPTY);
    }
  }, [isOpen]);

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
      toast.error('Please enter a valid gallons amount');
      return;
    }
    if (!f.fuelDate) {
      toast.error('Please select a date');
      return;
    }

    setSaving(true);
    try {
      const payload: ApparatusFuelLogCreate = {
        apparatusId,
        fuelDate: f.fuelDate,
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
    <Modal isOpen={isOpen} onClose={onClose} title="Add Fuel Log" size="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* Date & Type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Date *</label>
            <input type="date" className={inputClass} value={f.fuelDate} onChange={(e) => up('fuelDate', e.target.value)} required />
          </div>
          <div>
            <label className={labelClass}>Fuel Type *</label>
            <select className={selectClass} value={f.fuelType} onChange={(e) => up('fuelType', e.target.value)}>
              {FUEL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Gallons, Price, Total */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Gallons *</label>
            <input type="number" step="0.01" min="0" className={inputClass} value={f.gallons} onChange={(e) => handleGallonsChange(e.target.value)} required />
          </div>
          <div>
            <label className={labelClass}>Price / Gallon ($)</label>
            <input type="number" step="0.001" min="0" className={inputClass} value={f.pricePerGallon} onChange={(e) => handlePriceChange(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Total Cost ($)</label>
            <input type="number" step="0.01" min="0" className={inputClass} value={f.totalCost} onChange={(e) => up('totalCost', e.target.value)} />
          </div>
        </div>

        {/* Mileage & Hours */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Mileage at Fill</label>
            <input type="number" min="0" className={inputClass} value={f.mileageAtFill} onChange={(e) => up('mileageAtFill', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Engine Hours at Fill</label>
            <input type="number" min="0" step="0.1" className={inputClass} value={f.hoursAtFill} onChange={(e) => up('hoursAtFill', e.target.value)} />
          </div>
        </div>

        {/* Full Tank */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={f.isFullTank}
              onChange={(e) => up('isFullTank', e.target.checked)}
              className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-theme-text-secondary">Full tank fill-up</span>
          </label>
        </div>

        {/* Station */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Station Name</label>
            <input type="text" className={inputClass} value={f.stationName} onChange={(e) => up('stationName', e.target.value)} placeholder="Fuel station name" />
          </div>
          <div>
            <label className={labelClass}>Station Address</label>
            <input type="text" className={inputClass} value={f.stationAddress} onChange={(e) => up('stationAddress', e.target.value)} />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className={labelClass}>Notes</label>
          <textarea className={inputClass} rows={2} value={f.notes} onChange={(e) => up('notes', e.target.value)} />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
          <button type="button" onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : 'Add Fuel Log'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default FuelLogModal;
