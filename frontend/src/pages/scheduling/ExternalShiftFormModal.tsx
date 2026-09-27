/**
 * Log, or correct, a shift the member worked for another department.
 *
 * Create omits a blank optional field (`|| undefined`); edit sends `null` for
 * one, because the update endpoint reads an omitted key as "leave it alone"
 * and the member who emptied the box meant "clear it".
 *
 * The agency and apparatus are picked from the list scheduling officers keep,
 * never typed, so the department's apparatus summary counts one unit once. A
 * member whose unit is missing is told who can add it. An entry whose unit
 * has since left the list keeps it as its current value, so its date or hours
 * can still be corrected without moving it onto a different truck.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/Modal';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ExternalAgency, ExternalShiftEntry } from '../../modules/scheduling/services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { blankToNull } from '../../utils/formValues';

/** Matches the backend's ceiling: one entry is one shift. */
export const MAX_EXTERNAL_SHIFT_HOURS = 48;

/** Select value standing for the unit an edited entry already has. */
const CURRENT = '__current__';

export const NOT_LISTED_HINT =
  "Don't see it? Ask a scheduling officer to add it under Scheduling → Settings → Outside Apparatus.";

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
  const [agencyId, setAgencyId] = useState('');
  const [apparatusId, setApparatusId] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<ExternalAgency[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // Re-seeded on every open, so a half-typed entry for one shift cannot be
  // saved against the next one the member opens.
  useEffect(() => {
    if (!isOpen) return;
    setShiftDate(entry?.shift_date ?? today);
    setHours(entry ? String(entry.hours) : '');
    setAgencyId('');
    setApparatusId('');
    setRole(entry?.role ?? '');
    setNotes(entry?.notes ?? '');
  }, [isOpen, entry, today]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);
    schedulingService
      .getExternalApparatusOptions()
      .then((data) => {
        if (cancelled) return;
        setOptions(data.agencies);
        if (!entry) return;
        const unitId = entry.external_apparatus_id;
        const home = unitId ? data.agencies.find((a) => a.apparatus.some((u) => u.id === unitId)) : undefined;
        if (home && unitId) {
          setAgencyId(home.id);
          setApparatusId(unitId);
        } else {
          setAgencyId(CURRENT);
          setApparatusId(CURRENT);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setOptionsError(getErrorMessage(err, 'Failed to load the apparatus list'));
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, entry]);

  const units = useMemo(() => options.find((a) => a.id === agencyId)?.apparatus ?? [], [options, agencyId]);
  const hasAnyUnit = options.some((a) => a.apparatus.length > 0);

  const hoursValue = Number(hours);
  const hoursValid =
    hours !== '' && Number.isFinite(hoursValue) && hoursValue > 0 && hoursValue <= MAX_EXTERNAL_SHIFT_HOURS;
  const dateValid = shiftDate !== '' && shiftDate <= today;
  const canSave = hoursValid && dateValid && apparatusId !== '' && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      if (entry) {
        // The unit goes on the wire only when the member picked a different
        // one: an entry whose unit has left the list has nothing to re-send.
        const unitChanged = apparatusId !== CURRENT && apparatusId !== entry.external_apparatus_id;
        await schedulingService.updateExternalShift(entry.id, {
          shift_date: shiftDate,
          hours: hoursValue,
          ...(unitChanged ? { external_apparatus_id: apparatusId } : {}),
          role: blankToNull(role),
          notes: blankToNull(notes),
        });
        toast.success('Shift updated');
      } else {
        await schedulingService.logExternalShift({
          shift_date: shiftDate,
          hours: hoursValue,
          external_apparatus_id: apparatusId,
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="external-shift-agency" className="form-label">
                Department
              </label>
              <select
                id="external-shift-agency"
                className="form-input"
                value={agencyId}
                required
                disabled={optionsLoading}
                onChange={(e) => {
                  setAgencyId(e.target.value);
                  setApparatusId('');
                }}
              >
                <option value="">{optionsLoading ? 'Loading…' : 'Choose a department'}</option>
                {entry && agencyId === CURRENT && (
                  <option value={CURRENT}>{entry.agency_name} (no longer listed)</option>
                )}
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="external-shift-apparatus" className="form-label">
                Apparatus
              </label>
              <select
                id="external-shift-apparatus"
                className="form-input"
                value={apparatusId}
                required
                disabled={optionsLoading || agencyId === ''}
                onChange={(e) => setApparatusId(e.target.value)}
              >
                <option value="">Choose an apparatus</option>
                {entry && agencyId === CURRENT && (
                  <option value={CURRENT}>{entry.apparatus_name} (no longer listed)</option>
                )}
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.apparatus_type ? `${u.name} (${u.apparatus_type})` : u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {optionsError ? (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {optionsError}
            </p>
          ) : (
            !optionsLoading && (
              <p className="text-theme-text-muted text-sm">
                {hasAnyUnit ? '' : 'No outside apparatus has been set up yet. '}
                {NOT_LISTED_HINT}
              </p>
            )
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
