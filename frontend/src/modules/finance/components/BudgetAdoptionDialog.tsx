/**
 * Record the board's adoption of next year's budget, which activates it.
 *
 * The Treasurer's screen (`finance.manage`), offered on a draft year in board
 * review. The meeting date (not in the future) and the motion or minutes
 * reference are required; the backend refuses activation without them and
 * keeps them with the year. Activating makes the budget spendable and emails
 * each line owner their adopted lines, so the dialog says so.
 *
 * The checks here only spare a round trip; the backend makes the same ones
 * (the date against the department's calendar) and its message is what the
 * toast shows when it refuses.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { fiscalYearService } from '../services/api';
import type { FiscalYear, FiscalYearAdoptionPayload } from '../types';

/** The widths of `fiscal_years.adoption_reference` and the notes the API accepts. */
const MAX_REFERENCE = 500;
const MAX_NOTES = 4000;

interface BudgetAdoptionDialogProps {
  fiscalYear: Pick<FiscalYear, 'id' | 'name'>;
  onClose: () => void;
  /** Called after the year is adopted; the caller re-fetches what it shows. */
  onAdopted: (year: FiscalYear) => void;
}

export const BudgetAdoptionDialog: React.FC<BudgetAdoptionDialogProps> = ({ fiscalYear, onClose, onAdopted }) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const [adoptedOn, setAdoptedOn] = useState(today);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): FiscalYearAdoptionPayload | null => {
    const next: Record<string, string> = {};
    if (!adoptedOn) next.adoptedOn = 'Enter the date the board adopted the budget.';
    else if (adoptedOn > today) next.adoptedOn = 'The adoption date cannot be in the future.';
    if (!reference.trim()) next.reference = 'Enter the motion or minutes reference, for example "Motion 2026-14".';
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      adoptedOn,
      adoptionReference: reference.trim(),
      adoptionNotes: notes.trim() || undefined,
    };
  };

  const save = async (payload: FiscalYearAdoptionPayload) => {
    setSaving(true);
    try {
      const year = await fiscalYearService.activate(fiscalYear.id, payload);
      toast.success(`${fiscalYear.name} adopted and active`);
      onAdopted(year);
    } catch (err: unknown) {
      // The API's own words: not in board review, a future date.
      toast.error(getErrorMessage(err, 'Could not record the adoption'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = validate();
    if (payload === null) return;
    void save(payload);
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`adoption-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Record adoption of ${fiscalYear.name}`}
      titleId="adoption-form-title"
      aria-describedby="adoption-form-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Adopt and activate
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="adoption-form-description" className="text-theme-text-secondary text-sm">
          Record the board&apos;s vote. {fiscalYear.name} becomes the active fiscal year, its budget lines can be spent
          against, and each line owner is emailed their adopted amounts. The adoption is kept with the year and cannot
          be edited afterwards.
        </p>

        <div>
          <label htmlFor="adoption-date" className="form-label">
            Date the board adopted it
          </label>
          <input
            id="adoption-date"
            type="date"
            max={today}
            className="form-input"
            value={adoptedOn}
            onChange={(e) => setAdoptedOn(e.target.value)}
            aria-invalid={Boolean(errors.adoptedOn)}
            aria-describedby={errors.adoptedOn ? 'adoption-adoptedOn-error' : undefined}
          />
          {errorText('adoptedOn')}
        </div>

        <div>
          <label htmlFor="adoption-reference" className="form-label">
            Motion or minutes reference
          </label>
          <input
            id="adoption-reference"
            type="text"
            maxLength={MAX_REFERENCE}
            placeholder="e.g. Board minutes 12/10, motion 4"
            className="form-input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            aria-invalid={Boolean(errors.reference)}
            aria-describedby={errors.reference ? 'adoption-reference-error' : undefined}
          />
          {errorText('reference')}
        </div>

        <div>
          <label htmlFor="adoption-notes" className="form-label">
            Notes (optional)
          </label>
          <textarea
            id="adoption-notes"
            rows={3}
            maxLength={MAX_NOTES}
            placeholder="e.g. Passed 5-0; the gear line was raised at the meeting"
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
