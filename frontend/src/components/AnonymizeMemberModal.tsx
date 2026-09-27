/**
 * Anonymize a departed member: scrub their personal information for good while
 * keeping the department's operational history attached to a placeholder.
 *
 * Irreversible, so the officer types the member's name to confirm, as the
 * permanent-delete path does. The backend also marks the member deleted, so
 * they leave the roster and the caller navigates away on success.
 */

import React, { useEffect, useState } from 'react';
import { EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from './Modal';
import { memberStatusService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

interface AnonymizeMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: { id: string; name: string } | null;
  /** Called after the backend confirms. The member no longer exists to show. */
  onAnonymized: () => void | Promise<void>;
}

export const AnonymizeMemberModal: React.FC<AnonymizeMemberModalProps> = ({
  isOpen,
  onClose,
  member,
  onAnonymized,
}) => {
  const [confirmName, setConfirmName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on each open, so a name typed for one member never confirms another.
  useEffect(() => {
    if (isOpen) {
      setConfirmName('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen, member?.id]);

  const nameMatches = member !== null && confirmName.trim().toLowerCase() === member.name.trim().toLowerCase();

  const handleAnonymize = async () => {
    if (!member || !nameMatches || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await memberStatusService.anonymizeMember(member.id);
      toast.success(`${member.name}'s personal information has been removed`);
      onClose();
      await onAnonymized();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to anonymize the member. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onClose}
      title="Anonymize Member"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary">
            Keep their details
          </button>
          <button
            type="button"
            onClick={() => void handleAnonymize()}
            disabled={submitting || !nameMatches}
            className="btn-primary inline-flex items-center justify-center gap-2 font-medium"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
            Anonymize
          </button>
        </div>
      }
    >
      <div className="modal-body space-y-4">
        <p className="text-theme-text-secondary text-sm">
          This permanently removes <span className="text-theme-text-primary font-medium">{member?.name}</span>&rsquo;s
          personal information. <span className="font-medium">It cannot be undone</span>, and the member cannot be
          reactivated afterwards.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Removed</p>
            <ul className="text-theme-text-secondary mt-1 list-disc space-y-0.5 pl-4 text-sm">
              <li>Name, email, phone numbers and address</li>
              <li>Date of birth, photo and emergency contacts</li>
              <li>Sign-in credentials</li>
              <li>Medical screening details and leave reasons</li>
              <li>Their original application</li>
            </ul>
          </div>
          <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-3">
            <p className="text-theme-text-primary text-sm font-medium">Kept</p>
            <ul className="text-theme-text-secondary mt-1 list-disc space-y-0.5 pl-4 text-sm">
              <li>Training, attendance and hours</li>
              <li>Equipment custody and dues history</li>
              <li>Audit log and election records, unchanged</li>
            </ul>
            <p className="text-theme-text-muted mt-2 text-xs">
              These stay linked to a placeholder named &ldquo;Former Member&rdquo;.
            </p>
          </div>
        </div>
        <div>
          <label htmlFor="anonymize-member-confirm" className="form-label">
            Type <span className="font-semibold">{member?.name}</span> to confirm
          </label>
          <input
            id="anonymize-member-confirm"
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
            disabled={submitting}
            className="form-input"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default AnonymizeMemberModal;
