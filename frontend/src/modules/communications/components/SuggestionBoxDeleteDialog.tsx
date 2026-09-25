/**
 * Deleting a box that has received submissions. Offers archiving first,
 * because that keeps everything, and asks for the box's name before the
 * permanent delete, because that one cannot be undone.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { suggestionsService } from '../services/suggestionsService';
import type { SuggestionBoxAdmin } from '../types/suggestions';

interface SuggestionBoxDeleteDialogProps {
  box: SuggestionBoxAdmin;
  onClose: () => void;
  onArchived: (box: SuggestionBoxAdmin) => void;
  onDeleted: (boxId: string) => void;
}

const SuggestionBoxDeleteDialog: React.FC<SuggestionBoxDeleteDialogProps> = ({
  box,
  onClose,
  onArchived,
  onDeleted,
}) => {
  const [typed, setTyped] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const count = box.submissionCount;
  const nameMatches = typed.trim() === box.name;

  const archive = async () => {
    setIsWorking(true);
    try {
      // A full write, as the form sends: the update replaces the reviewer set.
      const saved = await suggestionsService.updateBox(box.id, {
        name: box.name,
        description: box.description ?? null,
        anonymityMode: box.anonymityMode,
        followUpEnabled: box.followUpEnabled,
        isActive: false,
        reviewerPositionIds: box.reviewerPositions.map((p) => p.id),
        reviewerMemberIds: box.reviewerMembers.map((m) => m.id),
        watcherPositionIds: box.watcherPositions.map((p) => p.id),
        watcherMemberIds: box.watcherMembers.map((m) => m.id),
      });
      toast.success('Box archived. It no longer takes submissions.');
      onArchived(saved);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to archive the box.'));
    } finally {
      setIsWorking(false);
    }
  };

  const remove = async () => {
    setIsWorking(true);
    try {
      await suggestionsService.deleteBox(box.id, typed.trim());
      toast.success('Box deleted');
      onDeleted(box.id);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to delete the box.'));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Delete "${box.name}"?`} size="md">
      <div className="modal-body space-y-4">
        <div className="alert-danger text-sm">
          <p className="text-theme-text-primary">
            This box holds <strong>{count}</strong> {count === 1 ? 'submission' : 'submissions'}. Deleting it
            permanently removes every one of them, with their screenshots, replies and status history. This cannot be
            undone.
          </p>
        </div>
        {box.isActive && (
          <div className="space-y-2">
            <p className="text-theme-text-secondary text-sm">
              To stop new submissions but keep the record, archive the box instead. Its reviewers can still read
              everything in it.
            </p>
            <button
              type="button"
              className="btn-secondary px-4 py-2 disabled:opacity-60"
              disabled={isWorking}
              onClick={() => void archive()}
            >
              Archive instead
            </button>
          </div>
        )}
        <div className="border-theme-surface-border border-t pt-4">
          <label htmlFor="delete-box-confirm" className="form-label">
            Type <strong>{box.name}</strong> to delete it permanently
          </label>
          <input
            id="delete-box-confirm"
            className="form-input"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      </div>
      <div className="border-theme-surface-border flex justify-end gap-2 border-t px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="mobile-touch-target border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-md border px-4 py-2 text-sm font-medium"
        >
          Keep it
        </button>
        <button
          type="button"
          className="mobile-touch-target rounded-md bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900 disabled:opacity-60"
          disabled={isWorking || !nameMatches}
          onClick={() => void remove()}
        >
          Delete permanently
        </button>
      </div>
    </Modal>
  );
};

export default SuggestionBoxDeleteDialog;
