/**
 * Edit the voting window of a DRAFT election.
 *
 * Exists chiefly for the meeting-night runoff flow: auto-created runoffs
 * default to a start one hour out and a one-day duration, and there was
 * previously no UI to reschedule a draft election at all. Opening an
 * election also clamps a future start to "now" server-side, but the
 * secretary still needs a way to set a short voting window (e.g. a
 * 15-minute floor vote) before opening.
 */
import React, { useState, useCallback } from 'react';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { formatDateTime, formatForDateTimeInput } from '../../utils/dateFormatting';

interface EditDatesModalProps {
  currentStartDate: string;
  currentEndDate: string;
  error: string | null;
  onSubmit: (newStartDate: string, newEndDate: string) => void;
  onClose: () => void;
  timezone: string;
}

const inputClass =
  'mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring';

const quickButtonClass =
  'px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded-sm hover:bg-theme-surface-hover';

const EditDatesModal: React.FC<EditDatesModalProps> = ({
  currentStartDate,
  currentEndDate,
  error,
  onSubmit,
  onClose,
  timezone,
}) => {
  const [newStartDate, setNewStartDate] = useState(
    formatForDateTimeInput(new Date(currentStartDate), timezone)
  );
  const [newEndDate, setNewEndDate] = useState(
    formatForDateTimeInput(new Date(currentEndDate), timezone)
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  const startNow = () => {
    setNewStartDate(formatForDateTimeInput(new Date(), timezone));
  };

  const endMinutesFromStart = (minutes: number) => {
    // newStartDate is a wall-time string in the org timezone. Parsing it with
    // new Date() interprets it in the runtime's zone — which is fine as long
    // as we format the result with the same local interpretation instead of
    // re-converting through the org timezone (that would shift the wall time
    // by the zone offset).
    const base = newStartDate ? new Date(newStartDate) : new Date();
    const end = new Date(base.getTime() + minutes * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    setNewEndDate(
      `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-dates-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-theme-surface-border">
          <h3
            id="edit-dates-modal-title"
            className="text-lg font-medium text-theme-text-primary"
          >
            Edit Voting Window
          </h3>
        </div>

        <div className="px-6 py-4">
          {error && (
            <div
              className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary">
                Current Window
              </label>
              <div className="mt-1 text-sm text-theme-text-primary">
                {formatDateTime(currentStartDate, timezone)} —{' '}
                {formatDateTime(currentEndDate, timezone)}
              </div>
            </div>

            <div>
              <label
                htmlFor="edit-dates-start"
                className="block text-sm font-medium text-theme-text-secondary"
              >
                Voting Opens
              </label>
              <DateTimeQuarterHour
                id="edit-dates-start"
                value={newStartDate}
                onChange={(val) => setNewStartDate(val)}
                className={inputClass}
              />
              <div className="mt-2">
                <button type="button" onClick={startNow} className={quickButtonClass}>
                  Start Now
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="edit-dates-end"
                className="block text-sm font-medium text-theme-text-secondary"
              >
                Voting Closes
              </label>
              <DateTimeQuarterHour
                id="edit-dates-end"
                value={newEndDate}
                onChange={(val) => setNewEndDate(val)}
                className={inputClass}
              />
              <div className="mt-2">
                <p className="text-xs text-theme-text-muted mb-2">Quick duration (from open):</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => endMinutesFromStart(15)}
                    className={quickButtonClass}
                  >
                    15 Min
                  </button>
                  <button
                    type="button"
                    onClick={() => endMinutesFromStart(30)}
                    className={quickButtonClass}
                  >
                    30 Min
                  </button>
                  <button
                    type="button"
                    onClick={() => endMinutesFromStart(60)}
                    className={quickButtonClass}
                  >
                    1 Hour
                  </button>
                  <button
                    type="button"
                    onClick={() => endMinutesFromStart(24 * 60)}
                    className={quickButtonClass}
                  >
                    1 Day
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-theme-text-muted">
                You can also close voting manually at any time once the election is
                open.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(newStartDate, newEndDate)}
              disabled={!newStartDate || !newEndDate}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              Save Window
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditDatesModal;
