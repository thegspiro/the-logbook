/**
 * Maintenance Record Modal
 *
 * Modal form for creating and editing maintenance records on an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { apparatusMaintenanceService, apparatusMaintenanceTypeService } from '../services/api';
import type {
  ApparatusMaintenance,
  ApparatusMaintenanceCreate,
  ApparatusMaintenanceType,
  ApparatusMaintenanceUpdate,
} from '../types';
import { blankToNull, numberOrNull } from '../../../utils/formValues';

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

type MaintenanceField = Exclude<keyof FormData, 'isCompleted'>;

/**
 * How the maintenance endpoints' field names land on this dialog (forms review
 * F-2), in screen order. Lengths are `ApparatusMaintenanceBase`'s max_length.
 */
const MAINTENANCE_FIELDS: Record<MaintenanceField, ServerFieldSpec> = {
  maintenanceTypeId: { label: 'Maintenance type' },
  scheduledDate: { label: 'Scheduled date' },
  dueDate: { label: 'Due date' },
  completedDate: { label: 'Completed date' },
  description: { label: 'Description' },
  workPerformed: { label: 'Work performed' },
  findings: { label: 'Findings' },
  performedBy: { label: 'Performed by', maxLength: 200 },
  vendor: { label: 'Vendor', maxLength: 200 },
  cost: { label: 'Cost' },
  invoiceNumber: { label: 'Invoice number', maxLength: 100 },
  mileageAtService: { label: 'Mileage at service' },
  hoursAtService: { label: 'Engine hours at service' },
  nextDueDate: { label: 'Next due date' },
  nextDueMileage: { label: 'Next due mileage' },
  nextDueHours: { label: 'Next due hours' },
  notes: { label: 'Notes' },
};

const IDS = Object.fromEntries(Object.keys(MAINTENANCE_FIELDS).map((k) => [k, `maintenance-${k}`])) as Record<
  MaintenanceField,
  string
>;

const inputClass = 'form-input px-3 focus:ring-red-500/50 focus:border-red-500';
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
  const [errors, setErrors] = useState<Partial<Record<MaintenanceField, string>>>({});
  // What the form held when it opened (or last saved), so Escape, the X and
  // Cancel can ask before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const isDirty = baseline !== '' && JSON.stringify(f) !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    if (!isOpen) return;
    void apparatusMaintenanceTypeService
      .getMaintenanceTypes({ isActive: true })
      .then(setMaintenanceTypes)
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    let seeded: FormData = EMPTY;
    if (editRecord) {
      seeded = {
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
      };
    }
    setF(seeded);
    setBaseline(JSON.stringify(seeded));
    setErrors({});
  }, [editRecord, isOpen]);

  const up = (k: keyof FormData, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k in MAINTENANCE_FIELDS) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<MaintenanceField, string>>) => {
    setErrors(next);
    const first = (Object.keys(MAINTENANCE_FIELDS) as MaintenanceField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(IDS[first])?.focus(), 0);
  };

  /** After a save that wrote everything but `refused`: flag those, and count only them as unsaved. */
  const keepRefused = (refused: Partial<Record<MaintenanceField, string>>) => {
    showErrors(refused);
    const stored = JSON.parse(baseline) as FormData;
    const keys = Object.keys(refused) as MaintenanceField[];
    setBaseline(JSON.stringify({ ...f, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) }));
    const first = (Object.keys(MAINTENANCE_FIELDS) as MaintenanceField[]).find((k) => refused[k]);
    if (first)
      toast.error(
        `Record saved, except ${MAINTENANCE_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
      );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<MaintenanceField, string>> = {};
    if (!f.maintenanceTypeId) missing.maintenanceTypeId = 'Select a maintenance type.';
    // A new record is not created until every field is fixed; an edit saves
    // the rest and keeps the stored value of a refused one (below).
    if (!editRecord && Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }

    setSaving(true);
    try {
      if (editRecord) {
        // Ticking "Mark as completed" on an open record with no completed date
        // lets the server stamp the department's today; a null here would land
        // after that stamp and erase it. Otherwise a blank clears the date.
        const completing = f.isCompleted && !editRecord.isCompleted;
        // Every field the form owns, every save: the backend applies updates
        // with exclude_unset, so a blank left out of the payload would keep
        // the old value. A blank goes as null, which clears it.
        const payload: ApparatusMaintenanceUpdate = {
          maintenanceTypeId: f.maintenanceTypeId,
          isCompleted: f.isCompleted,
          scheduledDate: f.scheduledDate || null,
          dueDate: f.dueDate || null,
          ...(f.completedDate || !completing ? { completedDate: f.completedDate || null } : {}),
          performedBy: blankToNull(f.performedBy),
          description: blankToNull(f.description),
          workPerformed: blankToNull(f.workPerformed),
          findings: blankToNull(f.findings),
          mileageAtService: numberOrNull(f.mileageAtService),
          hoursAtService: numberOrNull(f.hoursAtService),
          cost: numberOrNull(f.cost),
          vendor: blankToNull(f.vendor),
          invoiceNumber: blankToNull(f.invoiceNumber),
          nextDueDate: f.nextDueDate || null,
          nextDueMileage: numberOrNull(f.nextDueMileage),
          nextDueHours: numberOrNull(f.nextDueHours),
          notes: blankToNull(f.notes),
        };
        // Single-save rule (owner, 2026-11-05): a value the record cannot hold
        // is not written — its key is left out, which the backend reads as
        // "leave alone", so the stored value is kept — the rest saves, and the
        // field stays flagged until it is fixed.
        let refused: Partial<Record<MaintenanceField, string>> = missing;
        const send = (skip: Partial<Record<MaintenanceField, string>>) => {
          const rest: Record<string, unknown> = { ...payload };
          for (const key of Object.keys(skip)) delete rest[key];
          return apparatusMaintenanceService.updateMaintenanceRecord(editRecord.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = mapServerFieldErrors(err, MAINTENANCE_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          onSaved();
          keepRefused(refused);
          return;
        }
        toast.success('Maintenance record updated');
      } else {
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
        await apparatusMaintenanceService.createMaintenanceRecord(payload);
        toast.success('Maintenance record added');
      }
      onSaved();
      onClose();
    } catch (err) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new record is not created until it is fixed.
      const mapped = mapServerFieldErrors(err, MAINTENANCE_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save maintenance record'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={editRecord ? 'Edit Maintenance Record' : 'Add Maintenance Record'}
      size="lg"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : editRecord ? 'Save Changes' : 'Add Record'}
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
        <p className="text-theme-text-secondary text-sm">
          For work already done, tick Mark as completed and set the Completed Date. For upcoming work, leave it unticked
          and set a Due Date; it then counts toward Maintenance Due on the fleet page as the date approaches.
        </p>
        {/* Type & Status */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Maintenance Type" required error={errors.maintenanceTypeId} id={IDS.maintenanceTypeId}>
            {(field) => (
              <select
                {...field}
                className={selectClass}
                value={f.maintenanceTypeId}
                onChange={(e) => up('maintenanceTypeId', e.target.value)}
              >
                <option value="">Select type...</option>
                {maintenanceTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <div className="flex items-end pb-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={f.isCompleted}
                onChange={(e) => up('isCompleted', e.target.checked)}
                className="form-checkbox"
              />
              <span className="text-theme-text-secondary text-sm">Mark as completed</span>
            </label>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Scheduled Date" error={errors.scheduledDate} id={IDS.scheduledDate}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="date"
                value={f.scheduledDate}
                onChange={(e) => up('scheduledDate', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Due Date" error={errors.dueDate} id={IDS.dueDate}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="date"
                value={f.dueDate}
                onChange={(e) => up('dueDate', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Completed Date" error={errors.completedDate} id={IDS.completedDate}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="date"
                value={f.completedDate}
                onChange={(e) => up('completedDate', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Description */}
        <FormField label="Description" error={errors.description} id={IDS.description}>
          {(field) => (
            <textarea
              {...field}
              className={inputClass}
              rows={2}
              placeholder="Brief description of work needed or performed"
              value={f.description}
              onChange={(e) => up('description', e.target.value)}
            />
          )}
        </FormField>

        {/* Work & Findings */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Work Performed" error={errors.workPerformed} id={IDS.workPerformed}>
            {(field) => (
              <textarea
                {...field}
                className={inputClass}
                rows={2}
                value={f.workPerformed}
                onChange={(e) => up('workPerformed', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Findings" error={errors.findings} id={IDS.findings}>
            {(field) => (
              <textarea
                {...field}
                className={inputClass}
                rows={2}
                value={f.findings}
                onChange={(e) => up('findings', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Performed By & Vendor */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Performed By"
            error={errors.performedBy}
            id={IDS.performedBy}
            maxLength={MAINTENANCE_FIELDS.performedBy.maxLength}
            count={f.performedBy.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="text"
                placeholder="Name of person or vendor"
                value={f.performedBy}
                onChange={(e) => up('performedBy', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Vendor"
            error={errors.vendor}
            id={IDS.vendor}
            maxLength={MAINTENANCE_FIELDS.vendor.maxLength}
            count={f.vendor.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="text"
                value={f.vendor}
                onChange={(e) => up('vendor', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Cost & Invoice */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Cost ($)" error={errors.cost} id={IDS.cost}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={f.cost}
                onChange={(e) => up('cost', e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Invoice Number"
            error={errors.invoiceNumber}
            id={IDS.invoiceNumber}
            maxLength={MAINTENANCE_FIELDS.invoiceNumber.maxLength}
            count={f.invoiceNumber.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="text"
                autoComplete="off"
                value={f.invoiceNumber}
                onChange={(e) => up('invoiceNumber', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Mileage & Hours at Service */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Mileage at Service" error={errors.mileageAtService} id={IDS.mileageAtService}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                inputMode="numeric"
                min="0"
                value={f.mileageAtService}
                onChange={(e) => up('mileageAtService', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Engine Hours at Service" error={errors.hoursAtService} id={IDS.hoursAtService}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={f.hoursAtService}
                onChange={(e) => up('hoursAtService', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Next Due. Only an open record's due_date feeds the Maintenance Due
            count (ApparatusService.get_maintenance_due); these fields stay on
            this record, so a newcomer expecting a reminder from them is told. */}
        <p className="text-theme-text-muted text-sm">
          The Next Due fields are kept on this record. They do not add the next service to Maintenance Due; for that,
          add a separate record with a Due Date.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Next Due Date" error={errors.nextDueDate} id={IDS.nextDueDate}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="date"
                value={f.nextDueDate}
                onChange={(e) => up('nextDueDate', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Next Due Mileage" error={errors.nextDueMileage} id={IDS.nextDueMileage}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                inputMode="numeric"
                min="0"
                value={f.nextDueMileage}
                onChange={(e) => up('nextDueMileage', e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Next Due Hours" error={errors.nextDueHours} id={IDS.nextDueHours}>
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={f.nextDueHours}
                onChange={(e) => up('nextDueHours', e.target.value)}
              />
            )}
          </FormField>
        </div>

        {/* Notes */}
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

export default MaintenanceRecordModal;
