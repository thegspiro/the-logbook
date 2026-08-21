import React, { useState } from 'react';
import { Modal } from '../Modal';

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
    <Modal
      isOpen
      onClose={onClose}
      title="Cancel Recurring Series"
      titleId="cancel-series-modal-title"
      onSubmit={handleSubmit}
      footer={
        <>
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
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Go Back
          </button>
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
        <p className="text-sm text-red-800 dark:text-red-300">
          This will cancel multiple events in this recurring series. This action cannot be undone.
        </p>
      </div>

      {submitError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert" aria-live="assertive">
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
          <span className="text-theme-text-secondary ml-2 text-sm">Only cancel future events (keep past events)</span>
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
          <span className="text-theme-text-secondary ml-2 text-sm">Send cancellation notifications to all RSVPs</span>
        </label>
      </div>
    </Modal>
  );
};

export default EventCancelSeriesModal;
