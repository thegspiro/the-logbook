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
              <h3 id="override-modal-title" className="text-theme-text-primary mb-1 text-lg font-medium">
                Edit Attendance Times
              </h3>
              <p className="text-theme-text-muted mb-4 text-sm">{editingRsvp.user_name}</p>

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
                  <label htmlFor="override_check_in" className="text-theme-text-secondary block text-sm font-medium">
                    Check-in Time
                  </label>
                  <DateTimeQuarterHour
                    id="override_check_in"
                    value={overrideCheckIn}
                    onChange={(val) => onOverrideCheckInChange(val)}
                    className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md shadow-xs sm:text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="override_check_out" className="text-theme-text-secondary block text-sm font-medium">
                    Check-out Time
                  </label>
                  <DateTimeQuarterHour
                    id="override_check_out"
                    value={overrideCheckOut}
                    onChange={(val) => onOverrideCheckOutChange(val)}
                    className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md shadow-xs sm:text-sm"
                  />
                </div>

                {overrideCheckIn && overrideCheckOut && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/20 dark:bg-blue-500/10">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Duration:</strong>{' '}
                      {Math.round((new Date(overrideCheckOut).getTime() - new Date(overrideCheckIn).getTime()) / 60000)}{' '}
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

export default EventOverrideAttendanceModal;
