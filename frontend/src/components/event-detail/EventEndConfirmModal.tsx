import React from 'react';
import { StopCircle } from 'lucide-react';

interface EventEndConfirmModalProps {
  eventTitle: string;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const EventEndConfirmModal: React.FC<EventEndConfirmModalProps> = ({
  eventTitle,
  submitting,
  onConfirm,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-event-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
          <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-500/20 sm:mx-0 sm:h-10 sm:w-10">
                <StopCircle className="h-6 w-6 text-red-600" />
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 id="end-event-modal-title" className="text-lg leading-6 font-medium text-theme-text-primary">
                  End Event Early
                </h3>
                <div className="mt-2">
                  <p className="text-sm text-theme-text-muted">
                    This will end &ldquo;{eventTitle}&rdquo; now and check out all currently checked-in members. Attendance durations will be calculated based on the current time.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              disabled={submitting}
              onClick={onConfirm}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-xs px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
            >
              {submitting ? 'Ending...' : 'End Event Now'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventEndConfirmModal;
