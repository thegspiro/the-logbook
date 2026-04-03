import React, { useState, useCallback } from 'react';
import type { Election } from '../../types/election';

interface DeleteElectionModalProps {
  election: Election;
  isDraft: boolean;
  deleting: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}

const DeleteElectionModal: React.FC<DeleteElectionModalProps> = ({
  election,
  isDraft,
  deleting,
  error,
  onSubmit,
  onClose,
}) => {
  const [deleteReason, setDeleteReason] = useState('');

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-election-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full">
        <div className={`px-6 py-4 border-b ${isDraft ? 'border-theme-surface-border' : 'border-red-500/30 bg-red-500/10'}`}>
          <h3 id="delete-election-modal-title" className={`text-lg font-medium ${isDraft ? 'text-theme-text-primary' : 'text-red-700 dark:text-red-300'}`}>
            {isDraft ? 'Delete Draft Election' : 'DELETE ACTIVE ELECTION'}
          </h3>
        </div>

        <div className="px-6 py-4">
          {!isDraft && (
            <div className="bg-red-500/10 border-l-4 border-red-600 p-4 mb-4" role="alert" aria-live="assertive">
              <div className="flex">
                <div className="shrink-0">
                  <svg className="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-bold text-red-700 dark:text-red-300">
                    CRITICAL: This is a destructive, irreversible action
                  </h3>
                  <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                    <p>Deleting this {election.status.toUpperCase()} election will:</p>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li><strong>Permanently destroy</strong> the election and all associated data</li>
                      <li>Send <strong>CRITICAL alert emails</strong> to all leadership members (Chief, President, Vice President, Secretary)</li>
                      <li>Create a <strong>CRITICAL severity</strong> audit trail entry</li>
                      {election.total_votes && election.total_votes > 0 && (
                        <li>Destroy <strong>{election.total_votes} votes</strong> that have already been cast</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isDraft && (
            <p className="text-sm text-theme-text-secondary mb-4">
              Are you sure you want to delete this draft election? This action cannot be undone.
            </p>
          )}

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3" role="alert" aria-live="assertive">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {!isDraft && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary">
                  Current Status
                </label>
                <div className="mt-1 text-sm font-semibold text-red-700 dark:text-red-400">
                  {election.status.toUpperCase()}
                </div>
              </div>

              <div>
                <label htmlFor="delete-election-reason" className="block text-sm font-medium text-theme-text-secondary">
                  Reason for Deletion <span aria-hidden="true">*</span> <span className="text-xs text-theme-text-muted">(minimum 10 characters)</span>
                </label>
                <textarea
                  id="delete-election-reason"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  rows={4}
                  placeholder="Provide a detailed reason why this active election must be deleted..."
                  className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                  required
                  aria-required="true"
                />
                <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                  This reason will be emailed to ALL leadership members and permanently logged in the audit trail.
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(deleteReason)}
              disabled={deleting || (!isDraft && deleteReason.trim().length < 10)}
              className={`px-4 py-2 text-white rounded-md disabled:opacity-50 ${
                isDraft
                  ? 'bg-theme-surface-hover hover:bg-theme-surface-secondary'
                  : 'bg-red-800 hover:bg-red-900'
              }`}
            >
              {deleting
                ? 'Deleting...'
                : isDraft
                ? 'Delete Draft'
                : 'Permanently Delete Election'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteElectionModal;
