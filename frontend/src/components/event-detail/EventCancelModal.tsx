import React, { useState } from 'react';
import { Modal } from '../Modal';

interface CancelEventPayload {
  cancellationReason: string;
  sendNotifications: boolean;
}

interface EventCancelModalProps {
  submitting: boolean;
  submitError: string | null;
  onSubmit: (payload: CancelEventPayload) => void;
  onClose: () => void;
}

const EventCancelModal: React.FC<EventCancelModalProps> = ({ submitting, submitError, onSubmit, onClose }) => {
  const [cancelReason, setCancelReason] = useState('');
  const [sendCancelNotifications, setSendCancelNotifications] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ cancellationReason: cancelReason, sendNotifications: sendCancelNotifications });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Cancel Event"
      titleId="cancel-event-modal-title"
      aria-describedby="cancel-event-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button
            type="submit"
            disabled={submitting || cancelReason.length < 10}
            className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
          >
            {submitting ? 'Cancelling...' : 'Cancel Event'}
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
      <div
        id="cancel-event-description"
        className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-500/30 dark:bg-yellow-500/10"
      >
        <p className="text-sm text-yellow-800 dark:text-yellow-400">
          This action cannot be undone. The event will be marked as cancelled.
        </p>
      </div>

      {submitError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert" aria-live="assertive">
          <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
        </div>
      )}

      <div>
        <label htmlFor="cancel_reason" className="text-theme-text-secondary block text-sm font-medium">
          Reason for Cancellation <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="cancel_reason"
          rows={4}
          required
          aria-required="true"
          minLength={10}
          maxLength={500}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          className="form-input mt-1 shadow-xs sm:text-sm"
          placeholder="Please provide a reason for cancelling this event..."
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

export default EventCancelModal;
