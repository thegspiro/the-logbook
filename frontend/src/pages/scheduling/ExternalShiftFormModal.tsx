/**
 * Log, or correct, a shift the member worked for another department.
 *
 * Create omits a blank optional field (`|| undefined`); edit sends `null` for
 * one, because the update endpoint reads an omitted key as "leave it alone"
 * and the member who emptied the box meant "clear it".
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/Modal';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ExternalShiftEntry } from '../../modules/scheduling/services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { blankToNull } from '../../utils/formValues';

/** Matches the backend's ceiling: one entry is one shift. */
export const MAX_EXTERNAL_SHIFT_HOURS = 48;

interface ExternalShiftFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Present when correcting an existing entry. */
  entry?: ExternalShiftEntry | null;
}

export const ExternalShiftFormModal: React.FC<ExternalShiftFormModalProps> = ({ isOpen, onClose, onSaved, entry }) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const isEdit = Boolean(entry);

  const [shiftDate, setShiftDate] = useState('');
  const [hours, setHours] = useState('');
  const [agency, setAgency] = useState('');
  const [apparatus, setApparatus] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seeded on every open, so a half-typed entry for one shift cannot be
  // saved against the next one the member opens.
  useEffect(() => {
    if (!isOpen) return;
    setShiftDate(entry?.shift_date ?? today);
    setHours(entry ? String(entry.hours) : '');
    setAgency(entry?.agency_name ?? '');
    setApparatus(entry?.apparatus ?? '');
    setRole(entry?.role ?? '');
    setNotes(entry?.notes ?? '');
  }, [isOpen, entry, today]);

  const hoursValue = Number(hours);
  const hoursValid =
    hours !== '' && Number.isFinite(hoursValue) && hoursValue > 0 && hoursValue <= MAX_EXTERNAL_SHIFT_HOURS;
  const dateValid = shiftDate !== '' && shiftDate <= today;
  const canSave = hoursValid && dateValid && agency.trim() !== '' && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      if (entry) {
        await schedulingService.updateExternalShift(entry.id, {
          shift_date: shiftDate,
          hours: hoursValue,
          agency_name: agency.trim(),
          apparatus: blankToNull(apparatus),
          role: blankToNull(role),
          notes: blankToNull(notes),
        });
        toast.success('Shift updated');
      } else {
        await schedulingService.logExternalShift({
          shift_date: shiftDate,
          hours: hoursValue,
          agency_name: agency.trim(),
          apparatus: apparatus.trim() || undefined,
          role: role.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        toast.success('Shift logged');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, isEdit ? 'Failed to update the shift' : 'Failed to log the shift'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit outside shift' : 'Log a shift with another department'}
    >
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="modal-body space-y-4">
          <p className="text-theme-text-secondary text-sm">
            For time on another jurisdiction&apos;s apparatus that isn&apos;t on our schedule. It counts toward your
            shift hours and shift requirements as soon as you save it. Your officers can see it and can remove it from
            your totals if it shouldn&apos;t count.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="external-shift-date" className="form-label">
                Date
              </label>
              <input
                id="external-shift-date"
                type="date"
                className="form-input"
                value={shiftDate}
                max={today}
                required
                onChange={(e) => setShiftDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="external-shift-hours" className="form-label">
                Hours
              </label>
              <input
                id="external-shift-hours"
                type="number"
                inputMode="decimal"
                className="form-input"
                value={hours}
                min={0.25}
                max={MAX_EXTERNAL_SHIFT_HOURS}
                step={0.25}
                required
                aria-describedby="external-shift-hours-hint"
                onChange={(e) => setHours(e.target.value)}
              />
              <p id="external-shift-hours-hint" className="text-theme-text-muted mt-1 text-xs">
                Up to {MAX_EXTERNAL_SHIFT_HOURS} hours per entry.
              </p>
            </div>
          </div>
          <div>
            <label htmlFor="external-shift-agency" className="form-label">
              Department or agency
            </label>
            <input
              id="external-shift-agency"
              className="form-input"
              value={agency}
              maxLength={255}
              required
              placeholder="e.g. Township Fire Company"
              onChange={(e) => setAgency(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="external-shift-apparatus" className="form-label">
                Apparatus <span className="text-theme-text-muted font-normal">(optional)</span>
              </label>
              <input
                id="external-shift-apparatus"
                className="form-input"
                value={apparatus}
                maxLength={100}
                placeholder="e.g. Engine 42"
                onChange={(e) => setApparatus(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="external-shift-role" className="form-label">
                Position <span className="text-theme-text-muted font-normal">(optional)</span>
              </label>
              <input
                id="external-shift-role"
                className="form-input"
                value={role}
                maxLength={100}
                placeholder="e.g. Driver"
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="external-shift-notes" className="form-label">
              Notes <span className="text-theme-text-muted font-normal">(optional)</span>
            </label>
            <textarea
              id="external-shift-notes"
              className="form-input"
              rows={3}
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
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
          <button type="submit" className="btn-primary" disabled={!canSave}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Log shift'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ExternalShiftFormModal;
