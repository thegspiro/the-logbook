/**
 * Deleting an evaluation, with the reason the member will read.
 *
 * The record of the deletion — who, when and this reason — stays on the
 * member's history and is shown to them, and they are emailed. The server
 * asks for step-up re-verification before it deletes anything.
 */
import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../components/Modal';

interface DeleteEvaluationDialogProps {
  isOpen: boolean;
  memberName: string;
  finalized: boolean;
  busy: boolean;
  onClose: () => void;
  onDelete: (reason: string) => void;
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

  // A reason typed for one evaluation is never carried to the next.
  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed) onDelete(trimmed);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete this evaluation?"
      onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Keep it
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !reason.trim()}>
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
        <div>
          <label htmlFor="delete-reason" className="form-label">
            Reason (shown to {memberName})
          </label>
          <textarea
            id="delete-reason"
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
