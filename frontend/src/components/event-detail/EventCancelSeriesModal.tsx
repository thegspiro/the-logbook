import React from 'react';

interface EventCancelSeriesModalProps {
  cancelReason: string;
  onCancelReasonChange: (reason: string) => void;
  sendCancelNotifications: boolean;
  onSendCancelNotificationsChange: (value: boolean) => void;
  cancelSeriesFutureOnly: boolean;
  onCancelSeriesFutureOnlyChange: (value: boolean) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const EventCancelSeriesModal: React.FC<EventCancelSeriesModalProps> = ({
  cancelReason,
  onCancelReasonChange,
  sendCancelNotifications,
  onSendCancelNotificationsChange,
  cancelSeriesFutureOnly,
  onCancelSeriesFutureOnlyChange,
  submitting,
  submitError,
  onSubmit,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-series-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); } }}
    >
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => { onClose(); }}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
          <form onSubmit={onSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <h3 id="cancel-series-modal-title" className="text-lg font-medium text-theme-text-primary mb-4">Cancel Recurring Series</h3>

              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 dark:bg-red-500/10 dark:border-red-500/30">
                <p className="text-sm text-red-800 dark:text-red-300">
                  This will cancel multiple events in this recurring series. This action cannot be undone.
                </p>
              </div>

              {submitError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert" aria-live="assertive">
                  <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
                </div>
              )}

              <div className="mb-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={cancelSeriesFutureOnly}
                    onChange={(e) => onCancelSeriesFutureOnlyChange(e.target.checked)}
                    className="form-checkbox border-theme-surface-border"
                  />
                  <span className="ml-2 text-sm text-theme-text-secondary">
                    Only cancel future events (keep past events)
                  </span>
                </label>
              </div>

              <div>
                <label htmlFor="cancel_series_reason" className="block text-sm font-medium text-theme-text-secondary">
                  Reason for Cancellation <span aria-hidden="true">*</span>
                </label>
                <textarea
                  id="cancel_series_reason"
                  rows={4}
                  required
                  aria-required="true"
                  minLength={10}
                  maxLength={500}
                  value={cancelReason}
                  onChange={(e) => onCancelReasonChange(e.target.value)}
                  className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                  placeholder="Please provide a reason for cancelling this series..."
                />
                <p className="mt-1 text-xs text-theme-text-muted">
                  {cancelReason.length}/500 characters (minimum 10)
                </p>
              </div>

              <div className="mt-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={sendCancelNotifications}
                    onChange={(e) => onSendCancelNotificationsChange(e.target.checked)}
                    className="form-checkbox border-theme-surface-border"
                  />
                  <span className="ml-2 text-sm text-theme-text-secondary">
                    Send cancellation notifications to all RSVPs
                  </span>
                </label>
              </div>
            </div>

            <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
              <button
                type="submit"
                disabled={submitting || cancelReason.length < 10}
                className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
              >
                {submitting ? 'Cancelling...' : 'Cancel Series'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Go Back
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EventCancelSeriesModal;
