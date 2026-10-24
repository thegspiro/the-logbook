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
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { expenseReportService } from '../services/api';
import type { CheckRequest, ExpenseReport } from '../types';

interface PayByCheckDialogProps {
  report: ExpenseReport;
  onClose: () => void;
  onRequested: (check: CheckRequest) => void;
}

export const PayByCheckDialog: React.FC<PayByCheckDialogProps> = ({ report, onClose, onRequested }) => {
  const [payeeAddress, setPayeeAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

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
      toast.error(getErrorMessage(err, 'Could not request the check'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Pay by check"
      titleId="pay-by-check-title"
      aria-describedby="pay-by-check-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Request check
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
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

        <div>
          <label htmlFor="pay-by-check-address" className="form-label">
            Mailing address <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <textarea
            id="pay-by-check-address"
            rows={3}
            maxLength={1000}
            className="form-input"
            value={payeeAddress}
            onChange={(e) => setPayeeAddress(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="pay-by-check-memo" className="form-label">
            Memo <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <input
            id="pay-by-check-memo"
            type="text"
            maxLength={500}
            placeholder={`Reimbursement ${report.reportNumber}`}
            className="form-input"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
