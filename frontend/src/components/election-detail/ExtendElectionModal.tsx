import React, { useState, useCallback } from 'react';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { formatDateTime, formatForDateTimeInput } from '../../utils/dateFormatting';

interface ExtendElectionModalProps {
  currentEndDate: string;
  error: string | null;
  onSubmit: (newEndDate: string) => void;
  onClose: () => void;
  timezone: string;
}

const ExtendElectionModal: React.FC<ExtendElectionModalProps> = ({
  currentEndDate,
  error,
  onSubmit,
  onClose,
  timezone,
}) => {
  const [newEndDate, setNewEndDate] = useState('');

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  const extendByHours = (hours: number) => {
    const currentEnd = new Date(currentEndDate);
    const newEnd = new Date(currentEnd.getTime() + hours * 60 * 60 * 1000);
    setNewEndDate(formatForDateTimeInput(newEnd, timezone));
  };

  const extendToEndOfDay = () => {
    const currentEnd = new Date(currentEndDate);
    currentEnd.setHours(23, 59, 0, 0);
    setNewEndDate(formatForDateTimeInput(currentEnd, timezone));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extend-election-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal w-full max-w-md rounded-lg shadow-xl">
        <div className="border-theme-surface-border border-b px-6 py-4">
          <h3 id="extend-election-modal-title" className="text-theme-text-primary text-lg font-medium">
            Extend Election Time
          </h3>
        </div>

        <div className="px-6 py-4">
          {error && (
            <div
              className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-theme-text-secondary block text-sm font-medium">Current End Time</label>
              <div className="text-theme-text-primary mt-1 text-sm">{formatDateTime(currentEndDate, timezone)}</div>
            </div>

            <div>
              <label htmlFor="extend-new-end-time" className="text-theme-text-secondary block text-sm font-medium">
                New End Time
              </label>
              <DateTimeQuarterHour
                id="extend-new-end-time"
                value={newEndDate}
                onChange={(val) => setNewEndDate(val)}
                className="form-input mt-1 shadow-xs"
              />

              <div className="mt-2">
                <p className="text-theme-text-muted mb-2 text-xs">Quick extend:</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => extendByHours(1)}
                    className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-sm px-3 py-1 text-xs"
                  >
                    +1 Hour
                  </button>
                  <button
                    type="button"
                    onClick={() => extendByHours(2)}
                    className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-sm px-3 py-1 text-xs"
                  >
                    +2 Hours
                  </button>
                  <button
                    type="button"
                    onClick={() => extendByHours(4)}
                    className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-sm px-3 py-1 text-xs"
                  >
                    +4 Hours
                  </button>
                  <button
                    type="button"
                    onClick={() => extendToEndOfDay()}
                    className="rounded-sm bg-blue-100 px-3 py-1 text-xs text-blue-700 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/30"
                  >
                    End of Day
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(newEndDate)}
              className="rounded-md bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
            >
              Extend Election
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExtendElectionModal;
