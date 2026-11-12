/**
 * Deleting an evaluation, with the reason the member will read.
 *
 * The record of the deletion — who, when and this reason — stays on the
 * member's history and is shown to them, and they are emailed. The server
 * asks for step-up re-verification before it deletes anything.
 */
import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../components/Modal';
import { FormField } from '../../../../components/ux/FormField';
import { useDiscardGuard } from '../../../../hooks/useDiscardGuard';
import { mapServerFieldErrors } from '../../../../utils/serverFieldErrors';

/** EvaluationAmend / EvaluationDelete in schemas/evaluation.py: 1 to 2000 characters. */
const MAX_REASON = 2000;

interface DeleteEvaluationDialogProps {
  isOpen: boolean;
  memberName: string;
  finalized: boolean;
  busy: boolean;
  onClose: () => void;
  /** A 422 the page rethrows is shown on the reason field here. */
  onDelete: (reason: string) => Promise<void> | void;
}

export const DeleteEvaluationDialog: React.FC<DeleteEvaluationDialogProps> = ({
  isOpen,
  memberName,
  finalized,
  busy,
  onClose,
  onDelete,
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
      document.getElementById('delete-reason')?.focus();
      return;
    }
    setError(null);
    try {
      await onDelete(trimmed);
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, { reason: { label: 'Reason', maxLength: MAX_REASON } });
      if (mapped) setError(mapped.fieldErrors.reason ?? mapped.unmatched.join(' '));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Delete this evaluation?"
      noValidate
      onSubmit={(e) => void submit(e)}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={requestClose}>
            Keep it
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            Delete evaluation
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-theme-text-primary">
          {finalized
            ? `${memberName}'s finalized evaluation, its signatures and its PDF are removed for good.`
            : `${memberName}'s evaluation and everything written in it so far are removed for good.`}
        </p>
        <p className="text-theme-text-secondary">
          A record that it was deleted, by you, and why, stays on {memberName}&apos;s history, and they are emailed.
        </p>
        <FormField
          label={`Reason (shown to ${memberName})`}
          required
          id="delete-reason"
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
