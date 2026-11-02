/**
 * Amending a finalized evaluation (owner decision 2026-11-02: from the
 * evaluator onward).
 *
 * The evaluator's part reopens for changes; calibration, approvals and the
 * member's acknowledgement run again, and a new PDF is made when it is final.
 * The reason is kept with the evaluation and printed on its PDF, and the
 * member and everyone who signed are emailed.
 */
import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../components/Modal';

interface AmendEvaluationDialogProps {
  isOpen: boolean;
  memberName: string;
  busy: boolean;
  onClose: () => void;
  onAmend: (reason: string) => void;
}

export const AmendEvaluationDialog: React.FC<AmendEvaluationDialogProps> = ({
  isOpen,
  memberName,
  busy,
  onClose,
  onAmend,
}) => {
  const [reason, setReason] = useState('');

  // A reason typed for one evaluation is never carried to the next.
  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed) onAmend(trimmed);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Amend this evaluation?"
      onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Keep it final
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !reason.trim()}>
            Amend evaluation
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-theme-text-primary">
          The evaluator&apos;s part reopens for changes. Calibration, approvals and {memberName}&apos;s acknowledgement
          run again, and a new PDF is made when it is final.
        </p>
        <p className="text-theme-text-secondary">
          The current text and PDF are not kept. {memberName} and everyone who signed are emailed, and the reason is
          shown with the evaluation and printed on its PDF.
        </p>
        <div>
          <label htmlFor="amend-reason" className="form-label">
            Reason (shown to {memberName})
          </label>
          <textarea
            id="amend-reason"
            className="form-input"
            required
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
