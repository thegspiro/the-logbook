import React from 'react';
import { StopCircle } from 'lucide-react';

interface EventEndConfirmModalProps {
  eventTitle: string;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const EventEndConfirmModal: React.FC<EventEndConfirmModalProps> = ({ eventTitle, submitting, onConfirm, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-event-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="bg-theme-surface-modal relative z-10 inline-block transform overflow-hidden rounded-lg text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:align-middle">
          <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10 dark:bg-red-500/20">
                <StopCircle className="h-6 w-6 text-red-600" />
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 id="end-event-modal-title" className="text-theme-text-primary text-lg leading-6 font-medium">
                  End Event Early
                </h3>
                <div className="mt-2">
                  <p className="text-theme-text-muted text-sm">
                    This will end &ldquo;{eventTitle}&rdquo; now and check out all currently checked-in members.
                    Attendance durations will be calculated based on the current time.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-theme-surface-secondary px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              disabled={submitting}
              onClick={onConfirm}
              className="inline-flex w-full justify-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-base font-medium text-white shadow-xs hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-hidden disabled:opacity-50 sm:ml-3 sm:w-auto sm:text-sm"
            >
              {submitting ? 'Ending...' : 'End Event Now'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring mt-3 inline-flex w-full justify-center rounded-md border px-4 py-2 text-base font-medium shadow-xs focus:ring-2 focus:ring-offset-2 focus:outline-hidden sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
