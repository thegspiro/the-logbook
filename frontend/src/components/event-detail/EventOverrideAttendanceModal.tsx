import React from 'react';
import type { RSVP } from '../../types/event';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';

interface EventOverrideAttendanceModalProps {
  editingRsvp: RSVP;
  overrideCheckIn: string;
  onOverrideCheckInChange: (value: string) => void;
  overrideCheckOut: string;
  onOverrideCheckOutChange: (value: string) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const EventOverrideAttendanceModal: React.FC<EventOverrideAttendanceModalProps> = ({
  editingRsvp,
  overrideCheckIn,
  onOverrideCheckInChange,
  overrideCheckOut,
  onOverrideCheckOutChange,
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
      aria-labelledby="override-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); } }}
    >
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
          <form onSubmit={onSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <h3 id="override-modal-title" className="text-lg font-medium text-theme-text-primary mb-1">
                Edit Attendance Times
              </h3>
              <p className="text-sm text-theme-text-muted mb-4">{editingRsvp.user_name}</p>

              {submitError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert" aria-live="assertive">
                  <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="override_check_in" className="block text-sm font-medium text-theme-text-secondary">
                    Check-in Time
                  </label>
                  <DateTimeQuarterHour
                    id="override_check_in"
                    value={overrideCheckIn}
                    onChange={(val) => onOverrideCheckInChange(val)}
                    className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="override_check_out" className="block text-sm font-medium text-theme-text-secondary">
                    Check-out Time
                  </label>
                  <DateTimeQuarterHour
                    id="override_check_out"
                    value={overrideCheckOut}
                    onChange={(val) => onOverrideCheckOutChange(val)}
                    className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                  />
                </div>

                {overrideCheckIn && overrideCheckOut && (
                  <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg p-3">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Duration:</strong>{' '}
                      {Math.round((new Date(overrideCheckOut).getTime() - new Date(overrideCheckIn).getTime()) / 60000)} minutes
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

export default EventOverrideAttendanceModal;
