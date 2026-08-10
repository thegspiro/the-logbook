import React, { useState } from 'react';

interface CancelSeriesPayload {
  cancellationReason: string;
  sendNotifications: boolean;
  futureOnly: boolean;
}

interface EventCancelSeriesModalProps {
  submitting: boolean;
  submitError: string | null;
  onSubmit: (payload: CancelSeriesPayload) => void;
  onClose: () => void;
}

const EventCancelSeriesModal: React.FC<EventCancelSeriesModalProps> = ({
  submitting,
  submitError,
  onSubmit,
  onClose,
}) => {
  const [cancelReason, setCancelReason] = useState('');
  const [sendCancelNotifications, setSendCancelNotifications] = useState(false);
  const [futureOnly, setFutureOnly] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ cancellationReason: cancelReason, sendNotifications: sendCancelNotifications, futureOnly });
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-series-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
    >
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="bg-theme-surface-modal relative z-10 inline-block transform overflow-hidden rounded-lg text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:align-middle">
          <form onSubmit={handleSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <h3 id="cancel-series-modal-title" className="text-theme-text-primary mb-4 text-lg font-medium">
                Cancel Recurring Series
              </h3>

              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
                <p className="text-sm text-red-800 dark:text-red-300">
                  This will cancel multiple events in this recurring series. This action cannot be undone.
                </p>
              </div>

              {submitError && (
                <div
                  className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                  role="alert"
                  aria-live="assertive"
                >
                  <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
                </div>
              )}

              <div className="mb-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={futureOnly}
                    onChange={(e) => setFutureOnly(e.target.checked)}
                    className="form-checkbox border-theme-surface-border"
                  />
                  <span className="text-theme-text-secondary ml-2 text-sm">
                    Only cancel future events (keep past events)
                  </span>
                </label>
              </div>

              <div>
                <label htmlFor="cancel_series_reason" className="text-theme-text-secondary block text-sm font-medium">
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
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="form-input mt-1 shadow-xs sm:text-sm"
                  placeholder="Please provide a reason for cancelling this series..."
                />
                <p className="text-theme-text-muted mt-1 text-xs">{cancelReason.length}/500 characters (minimum 10)</p>
              </div>

              <div className="mt-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={sendCancelNotifications}
                    onChange={(e) => setSendCancelNotifications(e.target.checked)}
                    className="form-checkbox border-theme-surface-border"
                  />
                  <span className="text-theme-text-secondary ml-2 text-sm">
                    Send cancellation notifications to all RSVPs
                  </span>
                </label>
              </div>
            </div>

            <div className="bg-theme-surface-secondary px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
              <button
                type="submit"
                disabled={submitting || cancelReason.length < 10}
                className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
              >
                {submitting ? 'Cancelling...' : 'Cancel Series'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring mt-3 inline-flex w-full justify-center rounded-md border px-4 py-2 text-base font-medium shadow-xs focus:ring-2 focus:ring-offset-2 focus:outline-hidden sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
