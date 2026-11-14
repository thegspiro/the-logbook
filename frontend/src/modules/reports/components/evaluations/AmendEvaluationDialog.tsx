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
import { FormField } from '../../../../components/ux/FormField';
import { useDiscardGuard } from '../../../../hooks/useDiscardGuard';
import { mapServerFieldErrors } from '../../../../utils/serverFieldErrors';

/** EvaluationAmend / EvaluationDelete in schemas/evaluation.py: 1 to 2000 characters. */
const MAX_REASON = 2000;

interface AmendEvaluationDialogProps {
  isOpen: boolean;
  memberName: string;
  busy: boolean;
  onClose: () => void;
  /** A 422 the page rethrows is shown on the reason field here. */
  onAmend: (reason: string) => Promise<void> | void;
}

export const AmendEvaluationDialog: React.FC<AmendEvaluationDialogProps> = ({
  isOpen,
  memberName,
  busy,
  onClose,
  onAmend,
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A reason typed for one evaluation is never carried to the next.
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError(null);
    }
  }, [isOpen]);

  // Called here rather than given to Modal so the cancel button asks too.
  const requestClose = useDiscardGuard({ isDirty: reason.trim() !== '', onClose });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(`Give a reason. ${memberName} will read it.`);
      document.getElementById('amend-reason')?.focus();
      return;
    }
    setError(null);
    try {
      await onAmend(trimmed);
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, { reason: { label: 'Reason', maxLength: MAX_REASON } });
      if (mapped) setError(mapped.fieldErrors.reason ?? mapped.unmatched.join(' '));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Amend this evaluation?"
      noValidate
      onSubmit={(e) => void submit(e)}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={requestClose}>
            Keep it final
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
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
        <FormField
          label={`Reason (shown to ${memberName})`}
          required
          id="amend-reason"
          error={error}
          maxLength={MAX_REASON}
          count={reason.length}
        >
          {(field) => (
            <textarea
              {...field}
              className="form-input"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
