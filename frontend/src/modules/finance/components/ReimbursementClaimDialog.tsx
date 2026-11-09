/**
 * Claim back an approved purchase the requester paid for with their own money.
 *
 * The server raises a draft expense report linked to the request, with one
 * line copied from it (its budget line, fund and receipt). This dialog asks
 * only what the request cannot know: what was actually paid, when, and where.
 * Whether the purchase may be claimed, and by whom, is the server's to decide
 * (app/services/finance_reimbursement.py); its refusal is shown as given.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { getTodayLocalDate, localToUTC } from '../../../utils/dateFormatting';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { purchaseRequestService } from '../services/api';
import type { ExpenseReport, PurchaseRequest } from '../types';
import { firstErrorField, refusalsOnFields, useFieldErrors } from '../utils/fieldRefusals';
import { MAX_MONEY_AMOUNT } from '../utils/moneyLimits';

type ClaimField = 'amount' | 'paidOn' | 'merchant';

/** `ReimbursementReportCreate` (schemas/finance.py). */
const SERVER_FIELDS: Record<ClaimField, ServerFieldSpec> = {
  amount: { label: 'What you paid' },
  paidOn: { label: 'Paid on', api: ['date_incurred', 'dateIncurred'] },
  merchant: { label: 'Where', maxLength: 300 },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as ClaimField[];
const FIELD_IDS: Record<ClaimField, string> = {
  amount: 'reimbursement-claim-amount',
  paidOn: 'reimbursement-claim-date',
  merchant: 'reimbursement-claim-merchant',
};

interface ReimbursementClaimDialogProps {
  purchase: PurchaseRequest;
  onClose: () => void;
  onClaimed: (report: ExpenseReport) => void;
}

export const ReimbursementClaimDialog: React.FC<ReimbursementClaimDialogProps> = ({ purchase, onClose, onClaimed }) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const initialAmount = Number(purchase.actualAmount ?? purchase.estimatedAmount).toFixed(2);
  const initialMerchant = purchase.vendor ?? '';
  const [amount, setAmount] = useState(initialAmount);
  const [paidOn, setPaidOn] = useState(today);
  const [merchant, setMerchant] = useState(initialMerchant);
  const { errors, setErrors, clearError } = useFieldErrors<ClaimField>();
  const [saving, setSaving] = useState(false);
  const isDirty = amount !== initialAmount || paidOn !== today || merchant !== initialMerchant;
  // Escape, the X and Cancel all ask before throwing away what was typed.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const flag = (next: Partial<Record<ClaimField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    const next: Partial<Record<ClaimField, string>> = {};
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      next.amount = 'Enter what you paid, more than zero.';
    }
    if (!paidOn || paidOn > today) next.paidOn = 'Choose the day you paid; it cannot be in the future.';
    if (!flag(next)) return;
    void save(parsed);
  };

  const save = async (parsed: number) => {
    setSaving(true);
    try {
      const report = await purchaseRequestService.claimReimbursement(purchase.id, {
        amount: parsed.toFixed(2),
        // Dated at noon in the department's timezone so it lands on the day
        // chosen; the substantiation deadline counts from this day.
        dateIncurred: localToUTC(`${paidOn}T12:00`, tz),
        merchant: merchant.trim() || undefined,
      });
      toast.success(`Expense report ${report.reportNumber} started`);
      onClaimed(report);
    } catch (err: unknown) {
      // No report is started until every field is accepted.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Could not start the reimbursement'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Request reimbursement"
      titleId="reimbursement-claim-title"
      aria-describedby="reimbursement-claim-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Start expense report
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="reimbursement-claim-description" className="text-theme-text-secondary text-sm">
          If you paid for {purchase.requestNumber} yourself, this starts an expense report for it, charged to the same
          budget line. Check the receipt on it and submit it for approval; once it is approved the finance office pays
          you back. The request was approved for {formatCurrency(purchase.estimatedAmount)}.
        </p>

        <FormField id={FIELD_IDS.amount} label="What you paid" error={errors.amount}>
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="decimal"
              min="0"
              max={MAX_MONEY_AMOUNT}
              step="0.01"
              className="form-input"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clearError('amount');
              }}
            />
          )}
        </FormField>

        <FormField id={FIELD_IDS.paidOn} label="Paid on" error={errors.paidOn}>
          {(field) => (
            <input
              {...field}
              type="date"
              max={today}
              className="form-input"
              value={paidOn}
              onChange={(e) => {
                setPaidOn(e.target.value);
                clearError('paidOn');
              }}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.merchant}
          label="Where"
          optional
          error={errors.merchant}
          maxLength={300}
          count={merchant.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              value={merchant}
              onChange={(e) => {
                setMerchant(e.target.value);
                clearError('merchant');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
