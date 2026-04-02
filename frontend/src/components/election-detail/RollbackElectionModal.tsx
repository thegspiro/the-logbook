import React, { useState, useCallback } from 'react';

interface RollbackElectionModalProps {
  currentStatus: string;
  targetStatus: string;
  rolling: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}

const RollbackElectionModal: React.FC<RollbackElectionModalProps> = ({
  currentStatus,
  targetStatus,
  rolling,
  error,
  onSubmit,
  onClose,
}) => {
  const [rollbackReason, setRollbackReason] = useState('');

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
      aria-labelledby="rollback-election-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full">
        <div className="px-6 py-4 border-b border-theme-surface-border">
          <h3 id="rollback-election-modal-title" className="text-lg font-medium text-theme-text-primary">Rollback Election</h3>
        </div>

        <div className="px-6 py-4">
          <div className="bg-orange-500/10 border-l-4 border-orange-500 p-4 mb-4">
            <div className="flex">
              <div className="shrink-0">
                <svg className="h-5 w-5 text-orange-700 dark:text-orange-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-orange-700 dark:text-orange-300">
                  This action requires careful consideration
                </h3>
                <div className="mt-2 text-sm text-orange-700 dark:text-orange-300">
                  <p>Rolling back this election will:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>Change the election status from <strong>{currentStatus.toUpperCase()}</strong> to <strong>{targetStatus.toUpperCase()}</strong></li>
                    <li>Send email notifications to all leadership members</li>
                    <li>Create an audit trail entry with your reason</li>
                    {targetStatus.toLowerCase() === 'open' && <li>Allow voting to resume (for closed&rarr;open)</li>}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3" role="alert" aria-live="assertive">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary">
                Current Status
              </label>
              <div className="mt-1 text-sm font-semibold text-theme-text-primary">
                {currentStatus.toUpperCase()}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-secondary">
                New Status After Rollback
              </label>
              <div className="mt-1 text-sm font-semibold text-green-600">
                {targetStatus.toUpperCase()}
              </div>
            </div>

            <div>
              <label htmlFor="rollback-reason" className="block text-sm font-medium text-theme-text-secondary">
                Reason for Rollback <span aria-hidden="true">*</span> <span className="text-xs text-theme-text-muted">(minimum 10 characters)</span>
              </label>
              <textarea
                id="rollback-reason"
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                rows={4}
                placeholder="Example: Vote counting error discovered, need to recount all ballots..."
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                required
                aria-required="true"
              />
              <p className="mt-1 text-xs text-theme-text-muted">
                This reason will be sent to all leadership members and logged in the audit trail.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={rolling}
              className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(rollbackReason)}
              disabled={rolling || rollbackReason.trim().length < 10}
              className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
            >
              {rolling ? 'Rolling Back...' : 'Confirm Rollback'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RollbackElectionModal;
