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
      onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); } }}
    >
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
          <form onSubmit={onSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <h3 id="record-times-modal-title" className="text-lg font-medium text-theme-text-primary mb-4">Record Official Event Times</h3>

              <p className="text-sm text-theme-text-secondary mb-4">
                Record the actual start and end times of the event. All checked-in members will be credited for attendance based on these times.
              </p>

              {submitError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert" aria-live="assertive">
                  <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="actual_start_time" className="block text-sm font-medium text-theme-text-secondary">
                    Actual Start Time
                  </label>
                  <DateTimeQuarterHour
                    id="actual_start_time"
                    value={actualStartTime}
                    onChange={(val) => onActualStartTimeChange(val)}
                    className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                  />
                  {currentActualStartTime && (
                    <p className="mt-1 text-xs text-theme-text-muted">
                      Currently: {formatShortDateTime(currentActualStartTime, timezone)}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="actual_end_time" className="block text-sm font-medium text-theme-text-secondary">
                    Actual End Time
                  </label>
                  <DateTimeQuarterHour
                    id="actual_end_time"
                    value={actualEndTime}
                    onChange={(val) => onActualEndTimeChange(val)}
                    className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                  />
                  {currentActualEndTime && (
                    <p className="mt-1 text-xs text-theme-text-muted">
                      Currently: {formatShortDateTime(currentActualEndTime, timezone)}
                    </p>
                  )}
                </div>

                {actualStartTime && actualEndTime && (
                  <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Duration:</strong>{' '}
                      {Math.round((new Date(actualEndTime).getTime() - new Date(actualStartTime).getTime()) / 60000)} minutes
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
              >
                {submitting ? 'Saving...' : 'Save Times'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
