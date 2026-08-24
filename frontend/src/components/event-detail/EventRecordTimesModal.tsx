import React from 'react';
import { Modal } from '../Modal';
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
    <Modal
      isOpen
      onClose={onClose}
      title="Record Official Event Times"
      titleId="record-times-modal-title"
      aria-describedby="record-times-description"
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
      <p id="record-times-description" className="text-theme-text-secondary mb-4 text-sm">
        Record the actual start and end times of the event. All checked-in members will be credited for attendance based
        on these times.
      </p>

      {submitError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert" aria-live="assertive">
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
            className="form-input mt-1 shadow-xs sm:text-sm"
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
            className="form-input mt-1 shadow-xs sm:text-sm"
          />
          {currentActualEndTime && (
            <p className="text-theme-text-muted mt-1 text-xs">
              Currently: {formatShortDateTime(currentActualEndTime, timezone)}
            </p>
          )}
          {/* Recording an end time has always finalized attendance as a side
              effect — it is what credits the hours. Now that finalizing also
              locks the event, saying so beforehand is the difference between a
              deliberate close and a typo that needs a chief to undo. */}
          {actualEndTime && (
            <p className="text-theme-text-muted mt-1 text-xs">
              Saving an end time finalizes attendance and closes the event.
            </p>
          )}
        </div>

        {actualStartTime && actualEndTime && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-900/30">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Duration:</strong>{' '}
              {Math.round((new Date(actualEndTime).getTime() - new Date(actualStartTime).getTime()) / 60000)} minutes
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EventRecordTimesModal;
