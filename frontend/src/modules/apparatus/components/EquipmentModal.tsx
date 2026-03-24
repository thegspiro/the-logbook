/**
 * Equipment Modal
 *
 * Modal form for adding and editing equipment assigned to an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { apparatusEquipmentService } from '../services/api';
import type {
  ApparatusEquipment,
  ApparatusEquipmentCreate,
  ApparatusEquipmentUpdate,
} from '../types';

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

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

export const EquipmentModal: React.FC<EquipmentModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  apparatusId,
  editEquipment,
}) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editEquipment) {
      setF({
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
      });
    } else {
      setF(EMPTY);
    }
  }, [editEquipment, isOpen]);

  const up = (k: keyof FormData, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) {
      toast.error('Please enter an equipment name');
      return;
    }

    setSaving(true);
    try {
      if (editEquipment) {
        const payload: ApparatusEquipmentUpdate = {
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
        await apparatusEquipmentService.updateEquipment(editEquipment.id, payload);
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
      toast.error(getErrorMessage(err, 'Failed to save equipment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editEquipment ? 'Edit Equipment' : 'Add Equipment'}
      size="md"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* Name & Quantity */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className={labelClass}>Name *</label>
            <input
              type="text"
              className={inputClass}
              value={f.name}
              onChange={(e) => up('name', e.target.value)}
              placeholder="Equipment name"
              required
            />
          </div>
          <div>
            <label className={labelClass}>Quantity</label>
            <input type="number" min="1" className={inputClass} value={f.quantity} onChange={(e) => up('quantity', e.target.value)} />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className={labelClass}>Description</label>
          <textarea className={inputClass} rows={2} value={f.description} onChange={(e) => up('description', e.target.value)} />
        </div>

        {/* Location */}
        <div>
          <label className={labelClass}>Location on Apparatus</label>
          <input type="text" className={inputClass} value={f.locationOnApparatus} onChange={(e) => up('locationOnApparatus', e.target.value)} placeholder="e.g. Compartment 3, Driver Side" />
        </div>

        {/* Serial & Asset Tag */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Serial Number</label>
            <input type="text" className={inputClass} value={f.serialNumber} onChange={(e) => up('serialNumber', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Asset Tag</label>
            <input type="text" className={inputClass} value={f.assetTag} onChange={(e) => up('assetTag', e.target.value)} />
          </div>
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={f.isRequired}
              onChange={(e) => up('isRequired', e.target.checked)}
              className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-theme-text-secondary">Required</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={f.isMounted}
              onChange={(e) => up('isMounted', e.target.checked)}
              className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-theme-text-secondary">Mounted</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={f.isPresent}
              onChange={(e) => up('isPresent', e.target.checked)}
              className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-theme-text-secondary">Present</span>
          </label>
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
            {saving ? 'Saving...' : editEquipment ? 'Update Equipment' : 'Add Equipment'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default EquipmentModal;
