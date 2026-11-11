/**
 * Record or edit a pledge — a donor's promise of a gift not yet received.
 *
 * `fundraising.manage`, the gate on both endpoints. A donation recorded
 * against a pledge moves its fulfilled amount and status in the backend
 * (owner decision, 2026-11-01); the edit form still offers both, for money
 * that arrived some other way or a correction. The backend refuses a donor or
 * campaign outside the department.
 *
 * A create omits blank optional fields; an edit sends every field the form
 * owns, a cleared one as null (pitfall #1). The reminder switch is read by
 * the daily `grant_reminders` task, which emails the department's
 * fundraising managers — never the donor — 14 days and 1 day before the due
 * date. The stored payment schedule is not offered: nothing reads it
 * (pitfall #19).
 */

import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { blankToNull } from '../../../utils/formValues';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { fundraisingService } from '../services/api';
import { PledgeStatus } from '../types';
import type { Donor, FundraisingCampaign, Pledge, PledgeCreatePayload, PledgeUpdatePayload } from '../types';
import { PLEDGE_STATUS_LABELS, donorDisplayName } from '../utils/labels';

/** The pledge columns are Numeric(10, 2). */
const MAX_AMOUNT = 99_999_999.99;

type PledgeField =
  | 'donorId'
  | 'campaignId'
  | 'pledgedAmount'
  | 'pledgeDate'
  | 'dueDate'
  | 'fulfilledAmount'
  | 'status'
  | 'notes'
  | 'reminderEnabled';

/**
 * The fields as a 422 names them. Grant request schemas report the camelCase
 * alias; the mapper reads both spellings. `PledgeCreate` sets no max_length.
 */
const SERVER_FIELDS: Record<PledgeField, ServerFieldSpec> = {
  donorId: { label: 'Donor' },
  campaignId: { label: 'Campaign' },
  pledgedAmount: { label: 'Amount pledged' },
  pledgeDate: { label: 'Pledge date' },
  dueDate: { label: 'Due date' },
  fulfilledAmount: { label: 'Amount received so far' },
  status: { label: 'Status' },
  notes: { label: 'Notes' },
  reminderEnabled: { label: 'Send reminders' },
};

const FIELD_IDS: Record<PledgeField, string> = {
  donorId: 'pledge-donor',
  campaignId: 'pledge-campaign',
  pledgedAmount: 'pledge-amount',
  pledgeDate: 'pledge-date',
  dueDate: 'pledge-due',
  fulfilledAmount: 'pledge-fulfilled',
  status: 'pledge-status',
  notes: 'pledge-notes',
  reminderEnabled: 'pledge-reminder',
};

interface PledgeDialogProps {
  pledge?: Pledge | undefined;
  donors: Donor[];
  campaigns: FundraisingCampaign[];
  onClose: () => void;
  onSaved: () => void;
}

const amountError = (value: string, required: boolean): string | null => {
  if (value.trim() === '') return required ? 'Enter an amount greater than zero.' : null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (required && parsed === 0)) {
    return required ? 'Enter an amount greater than zero.' : 'Enter an amount of zero or more.';
  }
  if (parsed > MAX_AMOUNT) return 'That amount is too large.';
  return null;
};

export const PledgeDialog: React.FC<PledgeDialogProps> = ({ pledge, donors, campaigns, onClose, onSaved }) => {
  const tz = useTimezone();
  const isEdit = pledge !== undefined;
  const [donorId, setDonorId] = useState(pledge?.donorId ?? '');
  const [campaignId, setCampaignId] = useState(pledge?.campaignId ?? '');
  const [pledgedAmount, setPledgedAmount] = useState(pledge ? String(pledge.pledgedAmount) : '');
  const [pledgeDate, setPledgeDate] = useState(pledge?.pledgeDate ?? getTodayLocalDate(tz));
  const [dueDate, setDueDate] = useState(pledge?.dueDate ?? '');
  const [fulfilledAmount, setFulfilledAmount] = useState(pledge ? String(pledge.fulfilledAmount) : '0');
  const [status, setStatus] = useState<string>(pledge?.status ?? PledgeStatus.PENDING);
  const [notes, setNotes] = useState(pledge?.notes ?? '');
  const [reminderEnabled, setReminderEnabled] = useState(pledge?.reminderEnabled ?? true);
  const [errors, setErrors] = useState<Partial<Record<PledgeField, string>>>({});
  const [saving, setSaving] = useState(false);
  // An edit that saved everything but a refused field stays open on that
  // field; closing then still tells the caller something was saved.
  const partlySaved = useRef(false);

  const snapshot = JSON.stringify([
    donorId,
    campaignId,
    pledgedAmount,
    pledgeDate,
    dueDate,
    fulfilledAmount,
    status,
    notes,
    reminderEnabled,
  ]);
  const initialSnapshot = useRef(snapshot);
  const isDirty = snapshot !== initialSnapshot.current;
  const close = () => (partlySaved.current ? onSaved() : onClose());
  // Escape, the X and Cancel all ask before throwing away a changed form.
  const requestClose = useDiscardGuard({ isDirty, onClose: close });
  const clearError = (field: PledgeField) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  const focusField = (field: PledgeField | undefined) => {
    if (field) document.getElementById(FIELD_IDS[field])?.focus();
  };

  const validate = (): boolean => {
    const next: Partial<Record<PledgeField, string>> = {};
    const pledged = amountError(pledgedAmount, true);
    if (pledged) next.pledgedAmount = pledged;
    if (!pledgeDate) next.pledgeDate = 'Enter the date of the pledge.';
    if (dueDate && pledgeDate && dueDate < pledgeDate) next.dueDate = 'The due date cannot be before the pledge.';
    if (isEdit) {
      const fulfilled = amountError(fulfilledAmount, false);
      if (fulfilled) next.fulfilledAmount = fulfilled;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    void save();
  };

  const save = async () => {
    setSaving(true);
    try {
      if (pledge) {
        const payload: PledgeUpdatePayload = {
          donorId: donorId || null,
          campaignId: campaignId || null,
          pledgedAmount: Number(pledgedAmount).toFixed(2),
          pledgeDate,
          dueDate: dueDate || null,
          notes: blankToNull(notes),
          reminderEnabled,
        };
        // Only fields the user changed: recording a gift against the pledge
        // moves both on the server, so echoing the loaded values back would
        // undo a donation recorded while this dialog was open.
        const fulfilled = Number(fulfilledAmount || 0).toFixed(2);
        if (fulfilled !== Number(pledge.fulfilledAmount).toFixed(2)) payload.fulfilledAmount = fulfilled;
        if (status !== pledge.status) payload.status = status as PledgeStatus;
        let refused: Partial<Record<PledgeField, string>> = {};
        try {
          await fundraisingService.updatePledge(pledge.id, payload);
        } catch (err: unknown) {
          // Owner rule (2026-11-05) for a single-save form: a value the pledge
          // cannot hold is not written, the rest saves, and the field keeps
          // what was typed, flagged, until it is fixed. Anything the form has
          // no field for is a real failure and is reported as one.
          const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
          const keys = Object.keys(mapped?.fieldErrors ?? {}) as PledgeField[];
          if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
          refused = mapped.fieldErrors;
          const rest: PledgeUpdatePayload = { ...payload };
          for (const key of keys) delete rest[key];
          await fundraisingService.updatePledge(pledge.id, rest);
        }
        const firstRefused = (Object.keys(refused) as PledgeField[])[0];
        if (firstRefused) {
          partlySaved.current = true;
          setErrors(refused);
          toast.error(
            `Pledge saved, except ${SERVER_FIELDS[firstRefused].label.toLowerCase()}: ${refused[firstRefused] ?? ''} Fix it and save again.`
          );
          focusField(firstRefused);
          return;
        }
        toast.success('Pledge saved');
      } else {
        const payload: PledgeCreatePayload = {
          donorId: donorId || undefined,
          campaignId: campaignId || undefined,
          pledgedAmount: Number(pledgedAmount).toFixed(2),
          pledgeDate,
          dueDate: dueDate || undefined,
          notes: notes.trim() || undefined,
          reminderEnabled,
        };
        await fundraisingService.createPledge(payload);
        toast.success('Pledge recorded');
      }
      onSaved();
    } catch (err: unknown) {
      // A new pledge is recorded only once nothing is refused, so each
      // refusal goes on its field (forms review F-2).
      const mapped = pledge ? null : mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as PledgeField[];
      if (mapped && keys[0]) {
        setErrors(mapped.fieldErrors);
        focusField(keys[0]);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Could not save the pledge'));
    } finally {
      setSaving(false);
    }
  };

  const optional = <span className="text-theme-text-secondary font-normal">(optional)</span>;

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={isEdit ? 'Edit pledge' : 'Record pledge'}
      titleId="pledge-form-title"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save pledge' : 'Record pledge'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id={FIELD_IDS.donorId} label={<>Donor {optional}</>} error={errors.donorId}>
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={donorId}
                onChange={(e) => {
                  setDonorId(e.target.value);
                  clearError('donorId');
                }}
              >
                <option value="">Not in the donor directory</option>
                {donors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {donorDisplayName(d)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField id={FIELD_IDS.campaignId} label={<>Campaign {optional}</>} error={errors.campaignId}>
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={campaignId}
                onChange={(e) => {
                  setCampaignId(e.target.value);
                  clearError('campaignId');
                }}
              >
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField id={FIELD_IDS.pledgedAmount} label="Amount pledged" required error={errors.pledgedAmount}>
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className="form-input"
                value={pledgedAmount}
                onChange={(e) => {
                  setPledgedAmount(e.target.value);
                  clearError('pledgedAmount');
                }}
              />
            )}
          </FormField>
          <FormField id={FIELD_IDS.pledgeDate} label="Pledge date" required error={errors.pledgeDate}>
            {(field) => (
              <input
                {...field}
                type="date"
                className="form-input"
                value={pledgeDate}
                onChange={(e) => {
                  setPledgeDate(e.target.value);
                  clearError('pledgeDate');
                }}
              />
            )}
          </FormField>
          <FormField id={FIELD_IDS.dueDate} label={<>Due date {optional}</>} error={errors.dueDate}>
            {(field) => (
              <input
                {...field}
                type="date"
                className="form-input"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  clearError('dueDate');
                }}
              />
            )}
          </FormField>
        </div>

        {isEdit && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id={FIELD_IDS.fulfilledAmount}
              label="Amount received so far"
              error={errors.fulfilledAmount}
              hint="Donations recorded against this pledge add to this and set the status for you."
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="form-input"
                  value={fulfilledAmount}
                  onChange={(e) => {
                    setFulfilledAmount(e.target.value);
                    clearError('fulfilledAmount');
                  }}
                />
              )}
            </FormField>
            <FormField id={FIELD_IDS.status} label="Status" error={errors.status}>
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    clearError('status');
                  }}
                >
                  {Object.values(PledgeStatus).map((value) => (
                    <option key={value} value={value}>
                      {PLEDGE_STATUS_LABELS[value]}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
        )}

        <FormField id={FIELD_IDS.notes} label={<>Notes {optional}</>} error={errors.notes}>
          {(field) => (
            <textarea
              {...field}
              rows={2}
              className="form-input"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                clearError('notes');
              }}
            />
          )}
        </FormField>

        <div>
          <label className="text-theme-text-primary flex items-start gap-2 text-sm">
            <input
              id={FIELD_IDS.reminderEnabled}
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={reminderEnabled}
              onChange={(e) => {
                setReminderEnabled(e.target.checked);
                clearError('reminderEnabled');
              }}
              aria-invalid={errors.reminderEnabled ? true : undefined}
              aria-describedby={
                errors.reminderEnabled ? 'pledge-reminder-error pledge-reminder-help' : 'pledge-reminder-help'
              }
            />
            Send reminders
          </label>
          <p id="pledge-reminder-help" className="text-theme-text-secondary mt-1 text-xs">
            Emails the department&apos;s fundraising managers 14 days and 1 day before the due date while money is still
            owed. The donor is never emailed.
          </p>
          {errors.reminderEnabled && (
            <p id="pledge-reminder-error" className="mt-1 text-sm text-red-800 dark:text-red-300">
              {errors.reminderEnabled}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
