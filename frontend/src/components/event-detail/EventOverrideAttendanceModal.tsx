import React from 'react';
import { Modal } from '../Modal';
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
    <Modal
      isOpen
      onClose={onClose}
      title="Edit Attendance Times"
      titleId="override-modal-title"
      onSubmit={onSubmit}
      footer={
        <>
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
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Cancel
          </button>
        </>
      }
    >
      <p className="text-theme-text-muted mb-4 text-sm">{editingRsvp.user_name}</p>

      {submitError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert" aria-live="assertive">
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
            className="form-input mt-1 shadow-xs sm:text-sm"
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
            className="form-input mt-1 shadow-xs sm:text-sm"
          />
        </div>

        {overrideCheckIn && overrideCheckOut && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/20 dark:bg-blue-500/10">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Duration:</strong>{' '}
              {Math.round((new Date(overrideCheckOut).getTime() - new Date(overrideCheckIn).getTime()) / 60000)} minutes
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EventOverrideAttendanceModal;
