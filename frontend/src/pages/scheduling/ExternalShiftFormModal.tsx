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
 *
 * A shift is given by its start and end, with +12 and +24 presets for the
 * standard tours; the server derives the date and hours from them. An entry
 * logged before times were kept opens on its date and hours, and the member
 * can switch it to times. Start/end coupling is the admin-hours forms' own
 * (`entryTimes`), so a 24-hour tour across a DST change keeps its 24 hours.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/Modal';
import DateTimeQuarterHour from '../../components/ux/DateTimeQuarterHour';
import QuickDurationButtons from '../../modules/admin-hours/components/QuickDurationButtons';
import {
  addHoursExact,
  resolveEndUtc,
  syncEndToStartExact,
  type DerivedEndTime,
} from '../../modules/admin-hours/utils/entryTimes';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ExternalAgency, ExternalShiftEntry } from '../../modules/scheduling/services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatForDateTimeInput, getTodayLocalDate, localToUTC } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { blankToNull } from '../../utils/formValues';
import { formatHours } from '../../utils/hoursFormatting';
import { FormField } from '../../components/ux/FormField';
import { useDiscardGuard } from '../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../utils/serverFieldErrors';

/** Matches the backend's ceiling: one entry is one shift. */
export const MAX_EXTERNAL_SHIFT_HOURS = 48;

/** The standard tours: a 12-hour and a 24-hour shift. */
const EXTERNAL_SHIFT_PRESET_HOURS = [12, 24] as const;

const MS_PER_MINUTE = 60 * 1000;

/** Epoch ms of a UTC ISO string, or NaN when there is none. */
const instant = (iso: string): number => (iso ? new Date(iso).getTime() : NaN);

/** Select value standing for the unit an edited entry already has. */
const CURRENT = '__current__';

type ShiftField = 'start' | 'end' | 'shiftDate' | 'hours' | 'agency' | 'apparatus' | 'role' | 'notes';

// Limits from ExternalShiftHoursCreate / Update
// (backend/app/schemas/external_shift_hours.py).
const SHIFT_FIELDS: Record<ShiftField, ServerFieldSpec> = {
  start: { label: 'Start', api: 'start_at' },
  end: { label: 'End', api: 'end_at' },
  shiftDate: { label: 'Date', api: 'shift_date' },
  hours: { label: 'Hours', api: 'hours' },
  agency: { label: 'Department', api: [] },
  apparatus: { label: 'Apparatus', api: 'external_apparatus_id' },
  role: { label: 'Position', maxLength: 100, api: 'role' },
  notes: { label: 'Notes', maxLength: 2000, api: 'notes' },
};
const SHIFT_FIELD_IDS: Record<ShiftField, string> = {
  start: 'external-shift-start',
  end: 'external-shift-end',
  shiftDate: 'external-shift-date',
  hours: 'external-shift-hours',
  agency: 'external-shift-agency',
  apparatus: 'external-shift-apparatus',
  role: 'external-shift-role',
  notes: 'external-shift-notes',
};
/** The keys an edit leaves out when the server refuses a field; times travel together. */
const SHIFT_FIELD_KEYS: Record<ShiftField, readonly string[]> = {
  start: ['start_at', 'end_at'],
  end: ['start_at', 'end_at'],
  shiftDate: ['shift_date'],
  hours: ['hours'],
  agency: [],
  apparatus: ['external_apparatus_id'],
  role: ['role'],
  notes: ['notes'],
};

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

  // 'hours' only for an entry logged before times were kept, until the
  // member chooses to give it times.
  const [mode, setMode] = useState<'times' | 'hours'>('times');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  // The exact instant behind `end` when a preset or a start change derived it;
  // see `resolveEndUtc`.
  const [endPin, setEndPin] = useState<DerivedEndTime | null>(null);
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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ShiftField, string | undefined>>>({});
  // Set by the member's own edits, not by the re-seed or the unit lookup, so
  // a dialog opened and closed untouched never asks about discarding.
  const [changed, setChanged] = useState(false);
  const edited = (...fields: ShiftField[]) => {
    setChanged(true);
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const field of fields) next[field] = undefined;
      return next;
    });
  };
  const requestClose = useDiscardGuard({ isDirty: isOpen && changed, onClose });

  // Re-seeded on every open, so a half-typed entry for one shift cannot be
  // saved against the next one the member opens.
  useEffect(() => {
    if (!isOpen) return;
    const hasTimes = Boolean(entry?.start_at && entry.end_at);
    setMode(entry && !hasTimes ? 'hours' : 'times');
    if (entry?.start_at && entry.end_at) {
      const endLocal = formatForDateTimeInput(entry.end_at, tz);
      setStart(formatForDateTimeInput(entry.start_at, tz));
      setEnd(endLocal);
      setEndPin({ local: endLocal, utcMs: instant(entry.end_at) });
    } else {
      setStart('');
      setEnd('');
      setEndPin(null);
    }
    setShiftDate(entry?.shift_date ?? today);
    setHours(entry ? String(entry.hours) : '');
    setAgencyId('');
    setApparatusId('');
    setRole(entry?.role ?? '');
    setNotes(entry?.notes ?? '');
    setFieldErrors({});
    setChanged(false);
  }, [isOpen, entry, today, tz]);

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

  const handleStartChange = (value: string) => {
    edited('start', 'end');
    const synced = syncEndToStartExact(start, value, end, endPin, tz);
    setStart(value);
    setEnd(synced.local);
    setEndPin(synced.pin);
  };

  const handlePreset = (presetHours: number) => {
    edited('end');
    const derived = addHoursExact(start, presetHours, tz);
    setEnd(derived?.local ?? '');
    setEndPin(derived);
  };

  const startUtc = start ? localToUTC(start, tz) : '';
  const endUtc = end ? resolveEndUtc(end, endPin, tz) : '';
  const spanMinutes = startUtc && endUtc ? Math.round((instant(endUtc) - instant(startUtc)) / MS_PER_MINUTE) : NaN;
  const startDate = start.split('T')[0] ?? '';
  let timesProblem: string | null = null;
  if (startDate > today) timesProblem = 'The shift cannot start in the future';
  else if (Number.isFinite(spanMinutes) && spanMinutes <= 0) timesProblem = 'The shift must end after it starts';
  else if (spanMinutes > MAX_EXTERNAL_SHIFT_HOURS * 60)
    timesProblem = `One entry can cover at most ${MAX_EXTERNAL_SHIFT_HOURS} hours; log a longer stretch as the shifts it was`;
  const timesValid = Number.isFinite(spanMinutes) && spanMinutes > 0 && timesProblem === null;

  const hoursValue = Number(hours);
  const hoursValid =
    hours !== '' && Number.isFinite(hoursValue) && hoursValue > 0 && hoursValue <= MAX_EXTERNAL_SHIFT_HOURS;
  const dateValid = shiftDate !== '' && shiftDate <= today;

  const showFieldErrors = (errors: Partial<Record<ShiftField, string | undefined>>) => {
    setFieldErrors(errors);
    const first = (Object.keys(SHIFT_FIELD_IDS) as ShiftField[]).find((f) => errors[f]);
    if (first) document.getElementById(SHIFT_FIELD_IDS[first])?.focus();
  };

  /** What stops a save, on the field it concerns (forms review F-3). */
  const missingFields = (): Partial<Record<ShiftField, string>> => {
    const missing: Partial<Record<ShiftField, string>> = {};
    if (mode === 'times') {
      if (!start) missing.start = 'Enter when the shift started.';
      if (!end) missing.end = 'Enter when the shift ended.';
    } else {
      if (!dateValid) missing.shiftDate = shiftDate ? 'The date cannot be in the future.' : 'Enter the date.';
      if (!hoursValid) missing.hours = `Enter the hours, more than 0 and up to ${MAX_EXTERNAL_SHIFT_HOURS}.`;
    }
    if (agencyId === '') missing.agency = 'Choose the department.';
    else if (apparatusId === '') missing.apparatus = 'Choose the apparatus.';
    return missing;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const missing = missingFields();
    // A times problem is already shown under End; focus it rather than save.
    if (Object.keys(missing).length > 0 || (mode === 'times' && !timesValid)) {
      showFieldErrors(missing);
      if (Object.keys(missing).length === 0) document.getElementById(SHIFT_FIELD_IDS.end)?.focus();
      return;
    }
    setSaving(true);
    try {
      let refused: Partial<Record<ShiftField, string>> = {};
      if (entry) {
        // The unit goes on the wire only when the member picked a different
        // one: an entry whose unit has left the list has nothing to re-send.
        const unitChanged = apparatusId !== CURRENT && apparatusId !== entry.external_apparatus_id;
        const update: Record<string, unknown> = {
          ...(mode === 'times' ? { start_at: startUtc, end_at: endUtc } : { shift_date: shiftDate, hours: hoursValue }),
          ...(unitChanged ? { external_apparatus_id: apparatusId } : {}),
          role: blankToNull(role),
          notes: blankToNull(notes),
        };
        let saved;
        try {
          saved = await schedulingService.updateExternalShift(entry.id, update);
        } catch (err: unknown) {
          // Single-save rule (owner, 2026-11-05): what the entry cannot hold
          // is left out, the rest is written, and the field stays flagged.
          const mapped = mapServerFieldErrors(err, SHIFT_FIELDS);
          const keys = mapped ? (Object.keys(mapped.fieldErrors) as ShiftField[]) : [];
          if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
          refused = mapped.fieldErrors;
          const rest = { ...update };
          for (const key of keys) for (const apiKey of SHIFT_FIELD_KEYS[key]) delete rest[apiKey];
          saved = await schedulingService.updateExternalShift(entry.id, rest);
        }
        if (Object.keys(refused).length > 0) {
          onSaved();
          showFieldErrors(refused);
          toast.error('Shift saved, except the field marked in the form. Fix it and save again.');
          return;
        }
        toast.success(
          saved.status === 'pending' ? 'Shift updated; it counts once an officer approves it' : 'Shift updated'
        );
      } else {
        let saved;
        try {
          saved = await schedulingService.logExternalShift({
            start_at: startUtc,
            end_at: endUtc,
            external_apparatus_id: apparatusId,
            role: role.trim() || undefined,
            notes: notes.trim() || undefined,
          });
        } catch (err: unknown) {
          // Nothing is logged until each refused field is fixed.
          const mapped = mapServerFieldErrors(err, SHIFT_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          showFieldErrors(mapped.fieldErrors);
          return;
        }
        toast.success(
          saved.status === 'pending' ? 'Shift logged; it counts once an officer approves it' : 'Shift logged'
        );
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
      onClose={requestClose}
      title={isEdit ? 'Edit outside shift' : 'Log a shift with another department'}
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Log shift'}
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
        <p className="text-theme-text-secondary text-sm">
          For time on another jurisdiction&apos;s apparatus that isn&apos;t on our schedule. It counts toward your shift
          hours and shift requirements as soon as you save it. Your officers can see it and can remove it from your
          totals if it shouldn&apos;t count.
        </p>
        {mode === 'times' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Start" required id={SHIFT_FIELD_IDS.start} error={fieldErrors.start}>
                {(field) => (
                  <DateTimeQuarterHour
                    {...field}
                    value={start}
                    onChange={handleStartChange}
                    className="form-input"
                    timezone={tz}
                    timeLabel="Start time"
                  />
                )}
              </FormField>
              <FormField
                label="End"
                required
                id={SHIFT_FIELD_IDS.end}
                error={fieldErrors.end ?? timesProblem ?? undefined}
              >
                {(field) => (
                  <DateTimeQuarterHour
                    {...field}
                    value={end}
                    onChange={(value) => {
                      edited('end');
                      setEnd(value);
                      setEndPin(null);
                    }}
                    className="form-input"
                    timezone={tz}
                    timeLabel="End time"
                  />
                )}
              </FormField>
            </div>
            <QuickDurationButtons
              onSelect={handlePreset}
              disabled={!start}
              presets={EXTERNAL_SHIFT_PRESET_HOURS}
              signed
            />
            {timesValid && (
              <p className="text-theme-text-secondary text-sm">
                Counts as{' '}
                <span className="text-theme-text-primary font-medium">{formatHours(spanMinutes / 60)} hours</span>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-theme-text-secondary text-sm">
              This shift was logged as a date and hours, without its start and end times.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Date" required id={SHIFT_FIELD_IDS.shiftDate} error={fieldErrors.shiftDate}>
                {(field) => (
                  <input
                    {...field}
                    type="date"
                    className="form-input"
                    value={shiftDate}
                    max={today}
                    onChange={(e) => {
                      edited('shiftDate');
                      setShiftDate(e.target.value);
                    }}
                  />
                )}
              </FormField>
              <FormField
                label="Hours"
                required
                id={SHIFT_FIELD_IDS.hours}
                error={fieldErrors.hours}
                hint={`Up to ${MAX_EXTERNAL_SHIFT_HOURS} hours per entry.`}
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="decimal"
                    className="form-input"
                    value={hours}
                    min={0.25}
                    max={MAX_EXTERNAL_SHIFT_HOURS}
                    step={0.25}
                    onChange={(e) => {
                      edited('hours');
                      setHours(e.target.value);
                    }}
                  />
                )}
              </FormField>
            </div>
            <button
              type="button"
              className="text-sm font-medium underline"
              onClick={() => {
                edited('shiftDate', 'hours');
                setMode('times');
              }}
            >
              Enter start and end times instead
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Department" required id={SHIFT_FIELD_IDS.agency} error={fieldErrors.agency}>
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={agencyId}
                disabled={optionsLoading}
                onChange={(e) => {
                  edited('agency', 'apparatus');
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
            )}
          </FormField>
          <FormField label="Apparatus" required id={SHIFT_FIELD_IDS.apparatus} error={fieldErrors.apparatus}>
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={apparatusId}
                disabled={optionsLoading || agencyId === ''}
                onChange={(e) => {
                  edited('apparatus');
                  setApparatusId(e.target.value);
                }}
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
            )}
          </FormField>
        </div>
        {optionsError ? (
          <p className="text-sm text-red-800 dark:text-red-300" role="alert">
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
          <FormField
            label="Position"
            optional
            id={SHIFT_FIELD_IDS.role}
            error={fieldErrors.role}
            maxLength={SHIFT_FIELDS.role.maxLength}
            count={role.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                className="form-input"
                value={role}
                placeholder="e.g. Driver"
                onChange={(e) => {
                  edited('role');
                  setRole(e.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <FormField
          label="Notes"
          optional
          id={SHIFT_FIELD_IDS.notes}
          error={fieldErrors.notes}
          maxLength={SHIFT_FIELDS.notes.maxLength}
          count={notes.length}
        >
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              rows={3}
              value={notes}
              onChange={(e) => {
                edited('notes');
                setNotes(e.target.value);
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};

export default ExternalShiftFormModal;
