/**
 * Pay an approved expense report by check.
 *
 * The server raises a check request payable to the member who filed the
 * report, for what it still owes them (`amountOwed`: the total less any cash
 * advance), and submits it through the check-request approval chain. Issuing
 * that check is what marks the report paid. Nothing here is computed: the
 * amount and payee are the server's (CLAUDE.md pitfall #29).
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstErrorField, refusalsOnFields, useFieldErrors } from '../utils/fieldRefusals';
import { expenseReportService } from '../services/api';
import type { CheckRequest, ExpenseReport } from '../types';

type CheckField = 'payeeAddress' | 'memo';

/** `ReimbursementCheckCreate` (schemas/finance.py). */
const SERVER_FIELDS: Record<CheckField, ServerFieldSpec> = {
  payeeAddress: { label: 'Mailing address', maxLength: 1000 },
  memo: { label: 'Memo', maxLength: 500 },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as CheckField[];
const FIELD_IDS: Record<CheckField, string> = {
  payeeAddress: 'pay-by-check-address',
  memo: 'pay-by-check-memo',
};

interface PayByCheckDialogProps {
  report: ExpenseReport;
  onClose: () => void;
  onRequested: (check: CheckRequest) => void;
}

export const PayByCheckDialog: React.FC<PayByCheckDialogProps> = ({ report, onClose, onRequested }) => {
  const [payeeAddress, setPayeeAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError } = useFieldErrors<CheckField>();
  // Escape, the X and Cancel all ask before throwing away what was typed.
  const requestClose = useDiscardGuard({ isDirty: payeeAddress !== '' || memo !== '', onClose });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void save();
  };

  const save = async () => {
    setSaving(true);
    try {
      const check = await expenseReportService.payByCheck(report.id, {
        payeeAddress: payeeAddress.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      toast.success(`Check request ${check.requestNumber} sent for approval`);
      onRequested(check);
    } catch (err: unknown) {
      // No check is requested until every field is accepted.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        setErrors(mapped.fieldErrors);
        const first = firstErrorField(mapped.fieldErrors, FIELD_ORDER);
        if (first) document.getElementById(FIELD_IDS[first])?.focus();
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Could not request the check'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Pay by check"
      titleId="pay-by-check-title"
      aria-describedby="pay-by-check-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Request check
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="pay-by-check-description" className="text-theme-text-secondary text-sm">
          This raises a check request for {formatCurrency(report.amountOwed ?? report.totalAmount)}, payable to the
          member who filed {report.reportNumber}, and sends it through the check approval chain. Once it is approved,
          issuing the check marks this report paid.
        </p>

        <FormField
          id={FIELD_IDS.payeeAddress}
          label="Mailing address"
          optional
          error={errors.payeeAddress}
          maxLength={1000}
          count={payeeAddress.length}
        >
          {(field) => (
            <textarea
              {...field}
              rows={3}
              className="form-input"
              value={payeeAddress}
              onChange={(e) => {
                setPayeeAddress(e.target.value);
                clearError('payeeAddress');
              }}
            />
          )}
        </FormField>

        <FormField id={FIELD_IDS.memo} label="Memo" optional error={errors.memo} maxLength={500} count={memo.length}>
          {(field) => (
            <input
              {...field}
              type="text"
              placeholder={`Reimbursement ${report.reportNumber}`}
              className="form-input"
              value={memo}
              onChange={(e) => {
                setMemo(e.target.value);
                clearError('memo');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
