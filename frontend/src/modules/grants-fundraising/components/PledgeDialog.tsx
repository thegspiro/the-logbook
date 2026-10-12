/**
 * Record or edit a pledge — a donor's promise of a gift not yet received.
 *
 * `fundraising.manage`, the gate on both endpoints. A pledge's fulfilled
 * amount and status are recorded by whoever receives the money: nothing in
 * the backend moves them when a donation arrives, so the edit form asks for
 * both rather than guessing one from the other. The backend refuses a donor
 * or campaign outside the department.
 *
 * A create omits blank optional fields; an edit sends every field the form
 * owns, a cleared one as null (pitfall #1). The stored reminder switch and
 * payment schedule are not offered: nothing sends pledge reminders or reads
 * the schedule (pitfall #19).
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { fundraisingService } from '../services/api';
import { PledgeStatus } from '../types';
import type { Donor, FundraisingCampaign, Pledge, PledgeCreatePayload, PledgeUpdatePayload } from '../types';
import { PLEDGE_STATUS_LABELS, donorDisplayName } from '../utils/labels';

/** The pledge columns are Numeric(10, 2). */
const MAX_AMOUNT = 99_999_999.99;

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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
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
          fulfilledAmount: Number(fulfilledAmount || 0).toFixed(2),
          status: status as PledgeStatus,
          notes: blankToNull(notes),
        };
        await fundraisingService.updatePledge(pledge.id, payload);
        toast.success('Pledge saved');
      } else {
        const payload: PledgeCreatePayload = {
          donorId: donorId || undefined,
          campaignId: campaignId || undefined,
          pledgedAmount: Number(pledgedAmount).toFixed(2),
          pledgeDate,
          dueDate: dueDate || undefined,
          notes: notes.trim() || undefined,
        };
        await fundraisingService.createPledge(payload);
        toast.success('Pledge recorded');
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the pledge'));
    } finally {
      setSaving(false);
    }
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`pledge-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;
  const describedBy = (field: string) => (errors[field] ? `pledge-${field}-error` : undefined);
  const optional = <span className="text-theme-text-secondary font-normal">(optional)</span>;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit pledge' : 'Record pledge'}
      titleId="pledge-form-title"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save pledge' : 'Record pledge'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pledge-donor" className="form-label">
              Donor {optional}
            </label>
            <select
              id="pledge-donor"
              className="form-input"
              value={donorId}
              onChange={(e) => setDonorId(e.target.value)}
            >
              <option value="">Not in the donor directory</option>
              {donors.map((d) => (
                <option key={d.id} value={d.id}>
                  {donorDisplayName(d)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pledge-campaign" className="form-label">
              Campaign {optional}
            </label>
            <select
              id="pledge-campaign"
              className="form-input"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="">No campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pledge-amount" className="form-label">
              Amount pledged
            </label>
            <input
              id="pledge-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="form-input"
              value={pledgedAmount}
              onChange={(e) => setPledgedAmount(e.target.value)}
              aria-invalid={Boolean(errors.pledgedAmount)}
              aria-describedby={describedBy('pledgedAmount')}
            />
            {errorText('pledgedAmount')}
          </div>
          <div>
            <label htmlFor="pledge-date" className="form-label">
              Pledge date
            </label>
            <input
              id="pledge-date"
              type="date"
              className="form-input"
              value={pledgeDate}
              onChange={(e) => setPledgeDate(e.target.value)}
              aria-invalid={Boolean(errors.pledgeDate)}
              aria-describedby={describedBy('pledgeDate')}
            />
            {errorText('pledgeDate')}
          </div>
          <div>
            <label htmlFor="pledge-due" className="form-label">
              Due date {optional}
            </label>
            <input
              id="pledge-due"
              type="date"
              className="form-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-invalid={Boolean(errors.dueDate)}
              aria-describedby={describedBy('dueDate')}
            />
            {errorText('dueDate')}
          </div>
        </div>

        {isEdit && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pledge-fulfilled" className="form-label">
                Amount received so far
              </label>
              <input
                id="pledge-fulfilled"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className="form-input"
                value={fulfilledAmount}
                onChange={(e) => setFulfilledAmount(e.target.value)}
                aria-invalid={Boolean(errors.fulfilledAmount)}
                aria-describedby={describedBy('fulfilledAmount')}
              />
              {errorText('fulfilledAmount')}
            </div>
            <div>
              <label htmlFor="pledge-status" className="form-label">
                Status
              </label>
              <select
                id="pledge-status"
                className="form-input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {Object.values(PledgeStatus).map((value) => (
                  <option key={value} value={value}>
                    {PLEDGE_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="pledge-notes" className="form-label">
            Notes {optional}
          </label>
          <textarea
            id="pledge-notes"
            rows={2}
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
