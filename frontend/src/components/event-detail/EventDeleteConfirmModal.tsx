import React, { useState } from 'react';

interface EventDeleteConfirmModalProps {
  eventTitle: string;
  isRecurring: boolean;
  submitting: boolean;
  onConfirm: (scope: 'single' | 'series') => void;
  onClose: () => void;
}

const EventDeleteConfirmModal: React.FC<EventDeleteConfirmModalProps> = ({
  eventTitle,
  isRecurring,
  submitting,
  onConfirm,
  onClose,
}) => {
  const [deleteScope, setDeleteScope] = useState<'single' | 'series'>('single');

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-event-modal-title"
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
                <svg
                  className="h-6 w-6 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                <h3 id="delete-event-modal-title" className="text-theme-text-primary text-lg leading-6 font-medium">
                  Delete Event
                </h3>
                <div className="mt-2">
                  <p className="text-theme-text-muted text-sm">
                    Are you sure you want to permanently delete &ldquo;{eventTitle}&rdquo;? This will remove all RSVPs
                    and attendance records. This action cannot be undone.
                  </p>
                  {isRecurring && (
                    <div className="mt-4 space-y-2">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="deleteScope"
                          value="single"
                          checked={deleteScope === 'single'}
                          onChange={() => setDeleteScope('single')}
                          className="text-theme-primary focus:ring-theme-focus-ring"
                        />
                        <span className="text-theme-text-primary text-sm">Delete only this event</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="deleteScope"
                          value="series"
                          checked={deleteScope === 'series'}
                          onChange={() => setDeleteScope('series')}
                          className="text-theme-primary focus:ring-theme-focus-ring"
                        />
                        <span className="text-theme-text-primary text-sm">Delete all events in this series</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-theme-surface-secondary px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              disabled={submitting}
              onClick={() => onConfirm(deleteScope)}
              className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
            >
              {submitting ? 'Deleting...' : deleteScope === 'series' ? 'Delete Entire Series' : 'Delete Permanently'}
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

export default EventDeleteConfirmModal;
