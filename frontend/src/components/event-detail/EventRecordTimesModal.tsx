import React from 'react';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { formatShortDateTime } from '../../utils/dateFormatting';

interface EventRecordTimesModalProps {
  actualStartTime: string;
  onActualStartTimeChange: (value: string) => void;
  actualEndTime: string;
  onActualEndTimeChange: (value: string) => void;
  currentActualStartTime?: string | null | undefined;
  currentActualEndTime?: string | null | undefined;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  timezone: string;
}

const EventRecordTimesModal: React.FC<EventRecordTimesModalProps> = ({
  actualStartTime,
  onActualStartTimeChange,
  actualEndTime,
  onActualEndTimeChange,
  currentActualStartTime,
  currentActualEndTime,
  submitting,
  submitError,
  onSubmit,
  onClose,
  timezone,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-times-modal-title"
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
          <form onSubmit={onSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <h3 id="record-times-modal-title" className="text-theme-text-primary mb-4 text-lg font-medium">
                Record Official Event Times
              </h3>

              <p className="text-theme-text-secondary mb-4 text-sm">
                Record the actual start and end times of the event. All checked-in members will be credited for
                attendance based on these times.
              </p>

              {submitError && (
                <div
                  className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                  role="alert"
                  aria-live="assertive"
                >
                  <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="actual_start_time" className="text-theme-text-secondary block text-sm font-medium">
                    Actual Start Time
                  </label>
                  <DateTimeQuarterHour
                    id="actual_start_time"
                    value={actualStartTime}
                    onChange={(val) => onActualStartTimeChange(val)}
                    className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md shadow-xs sm:text-sm"
                  />
                  {currentActualStartTime && (
                    <p className="text-theme-text-muted mt-1 text-xs">
                      Currently: {formatShortDateTime(currentActualStartTime, timezone)}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="actual_end_time" className="text-theme-text-secondary block text-sm font-medium">
                    Actual End Time
                  </label>
                  <DateTimeQuarterHour
                    id="actual_end_time"
                    value={actualEndTime}
                    onChange={(val) => onActualEndTimeChange(val)}
                    className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md shadow-xs sm:text-sm"
                  />
                  {currentActualEndTime && (
                    <p className="text-theme-text-muted mt-1 text-xs">
                      Currently: {formatShortDateTime(currentActualEndTime, timezone)}
                    </p>
                  )}
                </div>

                {actualStartTime && actualEndTime && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-900/30">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Duration:</strong>{' '}
                      {Math.round((new Date(actualEndTime).getTime() - new Date(actualStartTime).getTime()) / 60000)}{' '}
                      minutes
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-theme-surface-secondary px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
              >
                {submitting ? 'Saving...' : 'Save Times'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring mt-3 inline-flex w-full justify-center rounded-md border px-4 py-2 text-base font-medium shadow-xs focus:ring-2 focus:ring-offset-2 focus:outline-hidden sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EventRecordTimesModal;
