/**
 * Create or edit a dues schedule — what each member owes, and when.
 *
 * The Treasurer's screen (`finance.manage`, the gate on both endpoints).
 * A schedule on its own bills nobody: member dues are created from it by
 * **Generate dues** on the dues page.
 *
 * The schedule model also stores a grace period, a late fee, a fiscal year and
 * the membership types it applies to, but nothing reads any of them — no late
 * fee is ever charged and generation bills every active member — so this form
 * does not offer them (CLAUDE.md pitfall #19).
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { localToUTC, toLocalISODate } from '../../../utils/dateFormatting';
import { blankToNull } from '../../../utils/formValues';
import { useTimezone } from '../../../hooks/useTimezone';
import { duesService } from '../services/api';
import { DuesFrequency } from '../types';
import type { DuesSchedule, DuesScheduleCreatePayload, DuesScheduleUpdatePayload } from '../types';
import { DUES_FREQUENCY_LABELS } from '../utils/dues';

/** The largest amount the backend's Numeric(12, 2) column holds. */
const MAX_AMOUNT = 9_999_999_999.99;
const MAX_NAME = 200;

interface DuesScheduleDialogProps {
  /** The schedule being edited; omitted to create one. */
  schedule?: DuesSchedule | undefined;
  onClose: () => void;
  /** Called after a save; the caller re-fetches what it shows. */
  onSaved: (schedule: DuesSchedule) => void;
}

export const DuesScheduleDialog: React.FC<DuesScheduleDialogProps> = ({ schedule, onClose, onSaved }) => {
  const tz = useTimezone();
  const isEdit = schedule !== undefined;
  const [name, setName] = useState(schedule?.name ?? '');
  const [amount, setAmount] = useState(schedule ? String(schedule.amount) : '');
  const [frequency, setFrequency] = useState<DuesFrequency>(schedule?.frequency ?? DuesFrequency.ANNUAL);
  const [dueDate, setDueDate] = useState(schedule ? toLocalISODate(schedule.dueDate, tz) : '');
  const [isActive, setIsActive] = useState(schedule?.isActive ?? true);
  const [notes, setNotes] = useState(schedule?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the schedule a name, for example "2027 annual dues".';
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      next.amount = 'Enter an amount greater than zero.';
    } else if (parsed > MAX_AMOUNT) {
      next.amount = 'That amount is too large.';
    }
    if (!dueDate) next.dueDate = 'Enter the date dues are due.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    void save();
  };

  const save = async () => {
    const amountText = Number(amount).toFixed(2);
    // Midnight in the department's time zone, so the date reads back unchanged.
    const dueInstant = localToUTC(`${dueDate}T00:00`, tz);
    setSaving(true);
    try {
      let saved: DuesSchedule;
      if (schedule) {
        const payload: DuesScheduleUpdatePayload = {
          name: name.trim(),
          amount: amountText,
          frequency,
          dueDate: dueInstant,
          isActive,
          notes: blankToNull(notes),
        };
        saved = await duesService.updateSchedule(schedule.id, payload);
        toast.success('Dues schedule saved');
      } else {
        const payload: DuesScheduleCreatePayload = {
          name: name.trim(),
          amount: amountText,
          frequency,
          dueDate: dueInstant,
          notes: notes.trim() || undefined,
        };
        saved = await duesService.createSchedule(payload);
        toast.success('Dues schedule created — generate dues to bill members');
      }
      onSaved(saved);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the dues schedule'));
    } finally {
      setSaving(false);
    }
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`dues-schedule-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit dues schedule' : 'New dues schedule'}
      titleId="dues-schedule-form-title"
      aria-describedby="dues-schedule-form-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save schedule' : 'Create schedule'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="dues-schedule-form-description" className="text-theme-text-secondary text-sm">
          {isEdit
            ? 'Changes apply to dues generated from now on. Dues already generated keep the amount and due date they were created with.'
            : 'What each member owes and when. Saving bills nobody yet: use Generate dues to create a dues record for every active member.'}
        </p>

        <div>
          <label htmlFor="dues-schedule-name" className="form-label">
            Name
          </label>
          <input
            id="dues-schedule-name"
            type="text"
            maxLength={MAX_NAME}
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'dues-schedule-name-error' : undefined}
          />
          {errorText('name')}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="dues-schedule-amount" className="form-label">
              Amount per member
            </label>
            <input
              id="dues-schedule-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="form-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? 'dues-schedule-amount-error' : undefined}
            />
            {errorText('amount')}
          </div>
          <div>
            <label htmlFor="dues-schedule-frequency" className="form-label">
              Frequency
            </label>
            <select
              id="dues-schedule-frequency"
              className="form-input"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as DuesFrequency)}
            >
              {Object.values(DuesFrequency).map((value) => (
                <option key={value} value={value}>
                  {DUES_FREQUENCY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="dues-schedule-due-date" className="form-label">
            Due date
          </label>
          <input
            id="dues-schedule-due-date"
            type="date"
            className="form-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-invalid={Boolean(errors.dueDate)}
            aria-describedby={errors.dueDate ? 'dues-schedule-dueDate-error' : undefined}
          />
          {errorText('dueDate')}
        </div>

        <div>
          <label htmlFor="dues-schedule-notes" className="form-label">
            Notes <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <textarea
            id="dues-schedule-notes"
            rows={2}
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span className="text-theme-text-primary">
              Active — inactive schedules are hidden from the schedule list; their dues records stay.
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
};
