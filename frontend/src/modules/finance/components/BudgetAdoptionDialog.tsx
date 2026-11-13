/**
 * Record the board's adoption of next year's budget.
 *
 * The Treasurer's screen (`finance.manage`), offered on a draft year in board
 * review. The meeting date (not in the future) and the motion or minutes
 * reference are required; the backend keeps them with the year. The year
 * stays a draft, adopted, until the Treasurer starts it on or after its start
 * date — that is when it becomes spendable and line owners are emailed.
 *
 * The checks here only spare a round trip; the backend makes the same ones
 * (the date against the department's calendar) and its message is what the
 * toast shows when it refuses.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstErrorField, refusalsOnFields, useDialogFieldErrors } from '../utils/fieldRefusals';
import { getErrorMessage } from '../../../utils/errorHandling';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { fiscalYearService } from '../services/api';
import type { FiscalYear, FiscalYearAdoptionPayload } from '../types';

/** The widths of `fiscal_years.adoption_reference` and the notes the API accepts. */
const MAX_REFERENCE = 500;
const MAX_NOTES = 4000;

type AdoptionField = 'adoptedOn' | 'reference' | 'notes';

/** `FiscalYearAdoption` (schemas/finance.py). */
const SERVER_FIELDS: Record<AdoptionField, ServerFieldSpec> = {
  adoptedOn: { label: 'Date the board adopted it', api: ['adopted_on', 'adoptedOn'] },
  reference: {
    label: 'Motion or minutes reference',
    maxLength: MAX_REFERENCE,
    api: ['adoption_reference', 'adoptionReference'],
  },
  notes: { label: 'Notes', maxLength: MAX_NOTES, api: ['adoption_notes', 'adoptionNotes'] },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as AdoptionField[];
const FIELD_IDS: Record<AdoptionField, string> = {
  adoptedOn: 'adoption-date',
  reference: 'adoption-reference',
  notes: 'adoption-notes',
};

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
  const { errors, setErrors, clearError } = useDialogFieldErrors<AdoptionField>();
  const [saving, setSaving] = useState(false);
  const isDirty = adoptedOn !== today || reference !== '' || notes !== '';
  // Escape, the X and Cancel all ask before throwing away a typed adoption.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const flag = (next: Partial<Record<AdoptionField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const validate = (): FiscalYearAdoptionPayload | null => {
    const next: Partial<Record<AdoptionField, string>> = {};
    if (!adoptedOn) next.adoptedOn = 'Enter the date the board adopted the budget.';
    else if (adoptedOn > today) next.adoptedOn = 'The adoption date cannot be in the future.';
    if (!reference.trim()) next.reference = 'Enter the motion or minutes reference, for example "Motion 2026-14".';
    if (!flag(next)) return null;
    return {
      adoptedOn,
      adoptionReference: reference.trim(),
      adoptionNotes: notes.trim() || undefined,
    };
  };

  const save = async (payload: FiscalYearAdoptionPayload) => {
    setSaving(true);
    try {
      const year = await fiscalYearService.adopt(fiscalYear.id, payload);
      toast.success(`${fiscalYear.name} adopted`);
      onAdopted(year);
    } catch (err: unknown) {
      // Nothing is adopted until every field is accepted.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
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

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={`Record adoption of ${fiscalYear.name}`}
      titleId="adoption-form-title"
      aria-describedby="adoption-form-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record adoption
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="adoption-form-description" className="text-theme-text-secondary text-sm">
          Record the board&apos;s vote. The adoption is kept with {fiscalYear.name} and cannot be edited afterwards, and
          the budget can no longer change. Start the year on or after its start date to make it spendable; line owners
          are emailed their adopted amounts then.
        </p>

        <FormField id={FIELD_IDS.adoptedOn} label="Date the board adopted it" error={errors.adoptedOn}>
          {(field) => (
            <input
              {...field}
              type="date"
              max={today}
              className="form-input"
              value={adoptedOn}
              onChange={(e) => {
                setAdoptedOn(e.target.value);
                clearError('adoptedOn');
              }}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.reference}
          label="Motion or minutes reference"
          error={errors.reference}
          maxLength={MAX_REFERENCE}
          count={reference.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              placeholder="e.g. Board minutes 12/10, motion 4"
              className="form-input"
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
                clearError('reference');
              }}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.notes}
          label="Notes"
          optional
          error={errors.notes}
          maxLength={MAX_NOTES}
          count={notes.length}
        >
          {(field) => (
            <textarea
              {...field}
              rows={3}
              placeholder="e.g. Passed 5-0; the gear line was raised at the meeting"
              className="form-input"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                clearError('notes');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
