/**
 * Record unspent cash a member handed back against a cash advance.
 *
 * The server checks the amount against what is outstanding under a lock and
 * refuses the member who owes it (separation of duties), so this dialog only
 * prefills the outstanding balance and validates the shape of the input.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { getTodayLocalDate, localToUTC } from '../../../utils/dateFormatting';
import { advanceService } from '../services/api';
import type { AdvanceSummary } from '../types';
import { DUES_PAYMENT_METHODS } from '../utils/dues';

interface AdvanceReturnDialogProps {
  advance: AdvanceSummary;
  onClose: () => void;
  onSaved: () => void;
}

export const AdvanceReturnDialog: React.FC<AdvanceReturnDialogProps> = ({ advance, onClose, onSaved }) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const outstanding = Number(advance.outstanding);
  const [amount, setAmount] = useState(outstanding > 0 ? outstanding.toFixed(2) : '');
  const [returnedOn, setReturnedOn] = useState(today);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (parsed > outstanding) {
      setError(`Only ${formatCurrency(advance.outstanding)} of this advance is outstanding.`);
      return;
    }
    if (!returnedOn || returnedOn > today) {
      setError('Choose the day the cash came back; it cannot be in the future.');
      return;
    }
    setError('');
    void save(parsed);
  };

  const save = async (parsed: number) => {
    setSaving(true);
    try {
      await advanceService.recordReturn(advance.id, {
        amount: parsed.toFixed(2),
        // Today goes as "now"; an earlier day is dated at its noon in the
        // department's timezone, so it lands on that calendar day.
        returnedAt: returnedOn === today ? undefined : localToUTC(`${returnedOn}T12:00`, tz),
        paymentMethod: method || undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success('Return recorded');
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record the return'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Record returned cash"
      titleId="advance-return-form-title"
      aria-describedby="advance-return-form-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record return
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="advance-return-form-description" className="text-theme-text-secondary text-sm">
          {advance.memberName} has {formatCurrency(advance.outstanding)} of advance {advance.requestNumber} not yet
          accounted for. Record the cash they handed back.
        </p>

        <div>
          <label htmlFor="advance-return-amount" className="form-label">
            Amount returned
          </label>
          <input
            id="advance-return-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'advance-return-error' : undefined}
          />
          {error && (
            <p id="advance-return-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="advance-return-date" className="form-label">
            Returned on
          </label>
          <input
            id="advance-return-date"
            type="date"
            max={today}
            className="form-input"
            value={returnedOn}
            onChange={(e) => setReturnedOn(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="advance-return-method" className="form-label">
            Method <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <select
            id="advance-return-method"
            className="form-input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="">Not recorded</option>
            {DUES_PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="advance-return-reference" className="form-label">
            Reference <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <input
            id="advance-return-reference"
            type="text"
            maxLength={200}
            placeholder="Check number or receipt number"
            className="form-input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="advance-return-notes" className="form-label">
            Notes <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <textarea
            id="advance-return-notes"
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
