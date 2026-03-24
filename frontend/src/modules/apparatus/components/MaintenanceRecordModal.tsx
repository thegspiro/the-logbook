/**
 * Maintenance Record Modal
 *
 * Modal form for creating and editing maintenance records on an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import {
  apparatusMaintenanceService,
  apparatusMaintenanceTypeService,
} from '../services/api';
import type {
  ApparatusMaintenance,
  ApparatusMaintenanceCreate,
  ApparatusMaintenanceType,
} from '../types';

interface MaintenanceRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  apparatusId: string;
  editRecord?: ApparatusMaintenance | null;
}

interface FormData {
  maintenanceTypeId: string;
  scheduledDate: string;
  dueDate: string;
  completedDate: string;
  performedBy: string;
  isCompleted: boolean;
  description: string;
  workPerformed: string;
  findings: string;
  mileageAtService: string;
  hoursAtService: string;
  cost: string;
  vendor: string;
  invoiceNumber: string;
  nextDueDate: string;
  nextDueMileage: string;
  nextDueHours: string;
  notes: string;
}

const EMPTY: FormData = {
  maintenanceTypeId: '',
  scheduledDate: '',
  dueDate: '',
  completedDate: '',
  performedBy: '',
  isCompleted: false,
  description: '',
  workPerformed: '',
  findings: '',
  mileageAtService: '',
  hoursAtService: '',
  cost: '',
  vendor: '',
  invoiceNumber: '',
  nextDueDate: '',
  nextDueMileage: '',
  nextDueHours: '',
  notes: '',
};

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';
const selectClass = inputClass;

export const MaintenanceRecordModal: React.FC<MaintenanceRecordModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  apparatusId,
  editRecord,
}) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [maintenanceTypes, setMaintenanceTypes] = useState<ApparatusMaintenanceType[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    void apparatusMaintenanceTypeService
      .getMaintenanceTypes({ isActive: true })
      .then(setMaintenanceTypes)
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (editRecord) {
      setF({
        maintenanceTypeId: editRecord.maintenanceTypeId,
        scheduledDate: editRecord.scheduledDate?.split('T')[0] ?? '',
        dueDate: editRecord.dueDate?.split('T')[0] ?? '',
        completedDate: editRecord.completedDate?.split('T')[0] ?? '',
        performedBy: editRecord.performedBy ?? '',
        isCompleted: editRecord.isCompleted,
        description: editRecord.description ?? '',
        workPerformed: editRecord.workPerformed ?? '',
        findings: editRecord.findings ?? '',
        mileageAtService: editRecord.mileageAtService != null ? String(editRecord.mileageAtService) : '',
        hoursAtService: editRecord.hoursAtService != null ? String(editRecord.hoursAtService) : '',
        cost: editRecord.cost != null ? String(editRecord.cost) : '',
        vendor: editRecord.vendor ?? '',
        invoiceNumber: editRecord.invoiceNumber ?? '',
        nextDueDate: editRecord.nextDueDate?.split('T')[0] ?? '',
        nextDueMileage: editRecord.nextDueMileage != null ? String(editRecord.nextDueMileage) : '',
        nextDueHours: editRecord.nextDueHours != null ? String(editRecord.nextDueHours) : '',
        notes: editRecord.notes ?? '',
      });
    } else {
      setF(EMPTY);
    }
  }, [editRecord, isOpen]);

  const up = (k: keyof FormData, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.maintenanceTypeId) {
      toast.error('Please select a maintenance type');
      return;
    }

    setSaving(true);
    try {
      const payload: ApparatusMaintenanceCreate = {
        apparatusId,
        maintenanceTypeId: f.maintenanceTypeId,
        isCompleted: f.isCompleted,
        ...(f.scheduledDate ? { scheduledDate: f.scheduledDate } : {}),
        ...(f.dueDate ? { dueDate: f.dueDate } : {}),
        ...(f.completedDate ? { completedDate: f.completedDate } : {}),
        ...(f.performedBy ? { performedBy: f.performedBy } : {}),
        ...(f.description ? { description: f.description } : {}),
        ...(f.workPerformed ? { workPerformed: f.workPerformed } : {}),
        ...(f.findings ? { findings: f.findings } : {}),
        ...(f.mileageAtService ? { mileageAtService: Number(f.mileageAtService) } : {}),
        ...(f.hoursAtService ? { hoursAtService: Number(f.hoursAtService) } : {}),
        ...(f.cost ? { cost: Number(f.cost) } : {}),
        ...(f.vendor ? { vendor: f.vendor } : {}),
        ...(f.invoiceNumber ? { invoiceNumber: f.invoiceNumber } : {}),
        ...(f.nextDueDate ? { nextDueDate: f.nextDueDate } : {}),
        ...(f.nextDueMileage ? { nextDueMileage: Number(f.nextDueMileage) } : {}),
        ...(f.nextDueHours ? { nextDueHours: Number(f.nextDueHours) } : {}),
        ...(f.notes ? { notes: f.notes } : {}),
      };

      if (editRecord) {
        await apparatusMaintenanceService.updateMaintenanceRecord(editRecord.id, payload);
        toast.success('Maintenance record updated');
      } else {
        await apparatusMaintenanceService.createMaintenanceRecord(payload);
        toast.success('Maintenance record created');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save maintenance record'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editRecord ? 'Edit Maintenance Record' : 'Add Maintenance Record'}
      size="lg"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* Type & Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Maintenance Type *</label>
            <select
              className={selectClass}
              value={f.maintenanceTypeId}
              onChange={(e) => up('maintenanceTypeId', e.target.value)}
              required
            >
              <option value="">Select type...</option>
              {maintenanceTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={f.isCompleted}
                onChange={(e) => up('isCompleted', e.target.checked)}
                className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-theme-text-secondary">Mark as completed</span>
            </label>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Scheduled Date</label>
            <input type="date" className={inputClass} value={f.scheduledDate} onChange={(e) => up('scheduledDate', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Due Date</label>
            <input type="date" className={inputClass} value={f.dueDate} onChange={(e) => up('dueDate', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Completed Date</label>
            <input type="date" className={inputClass} value={f.completedDate} onChange={(e) => up('completedDate', e.target.value)} />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className={labelClass}>Description</label>
          <textarea className={inputClass} rows={2} value={f.description} onChange={(e) => up('description', e.target.value)} placeholder="Brief description of work needed or performed" />
        </div>

        {/* Work & Findings */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Work Performed</label>
            <textarea className={inputClass} rows={2} value={f.workPerformed} onChange={(e) => up('workPerformed', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Findings</label>
            <textarea className={inputClass} rows={2} value={f.findings} onChange={(e) => up('findings', e.target.value)} />
          </div>
        </div>

        {/* Performed By & Vendor */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Performed By</label>
            <input type="text" className={inputClass} value={f.performedBy} onChange={(e) => up('performedBy', e.target.value)} placeholder="Name of person or vendor" />
          </div>
          <div>
            <label className={labelClass}>Vendor</label>
            <input type="text" className={inputClass} value={f.vendor} onChange={(e) => up('vendor', e.target.value)} />
          </div>
        </div>

        {/* Cost & Invoice */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Cost ($)</label>
            <input type="number" step="0.01" min="0" className={inputClass} value={f.cost} onChange={(e) => up('cost', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Invoice Number</label>
            <input type="text" className={inputClass} value={f.invoiceNumber} onChange={(e) => up('invoiceNumber', e.target.value)} />
          </div>
        </div>

        {/* Mileage & Hours at Service */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Mileage at Service</label>
            <input type="number" min="0" className={inputClass} value={f.mileageAtService} onChange={(e) => up('mileageAtService', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Engine Hours at Service</label>
            <input type="number" min="0" step="0.1" className={inputClass} value={f.hoursAtService} onChange={(e) => up('hoursAtService', e.target.value)} />
          </div>
        </div>

        {/* Next Due */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Next Due Date</label>
            <input type="date" className={inputClass} value={f.nextDueDate} onChange={(e) => up('nextDueDate', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Next Due Mileage</label>
            <input type="number" min="0" className={inputClass} value={f.nextDueMileage} onChange={(e) => up('nextDueMileage', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Next Due Hours</label>
            <input type="number" min="0" step="0.1" className={inputClass} value={f.nextDueHours} onChange={(e) => up('nextDueHours', e.target.value)} />
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
            {saving ? 'Saving...' : editRecord ? 'Update Record' : 'Create Record'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default MaintenanceRecordModal;
