/**
 * Reactivate an archived member — the far side of the archive door.
 *
 * Archiving is reversible only through `POST /users/{id}/reactivate`; the
 * ordinary status change refuses to move a member out of `archived` so the
 * reactivation's own side effects (restoring the membership number, the
 * `member_reactivated` audit event) cannot be bypassed.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from './Modal';
import { memberStatusService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

interface ReactivateMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: { id: string; name: string } | null;
  /** Called after the backend confirms, so the caller can re-fetch the record. */
  onReactivated: () => void | Promise<void>;
}

export const ReactivateMemberModal: React.FC<ReactivateMemberModalProps> = ({
  isOpen,
  onClose,
  member,
  onReactivated,
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on each open: the list keeps this mounted across members, and a
  // reason typed for one must not be filed against the next.
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen, member?.id]);

  const handleReactivate = async () => {
    if (!member || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await memberStatusService.reactivateMember(member.id, { reason: reason.trim() || undefined });
      toast.success(`${member.name} has been reactivated`);
      await onReactivated();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to reactivate the member. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onClose}
      title="Reactivate Member"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary">
            Keep archived
          </button>
          <button
            type="button"
            onClick={() => void handleReactivate()}
            disabled={submitting || !member}
            className="btn-primary inline-flex items-center justify-center gap-2 font-medium"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Reactivate
          </button>
        </div>
      }
    >
      <div className="modal-body space-y-3">
        <p className="text-theme-text-secondary text-sm">
          <span className="text-theme-text-primary font-medium">{member?.name}</span> will be restored to{' '}
          <span className="font-medium">Active</span> status. Their profile, training and history are kept as they were.
          Their previous membership number is restored unless another member now holds it.
        </p>
        <div>
          <label htmlFor="reactivate-member-reason" className="form-label">
            Reason <span className="text-theme-text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="reactivate-member-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Returned to the department"
            className="form-input"
          />
          <p className="text-theme-text-muted mt-1 text-xs">
            Saved as the reason for the status change and in the audit log.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default ReactivateMemberModal;
