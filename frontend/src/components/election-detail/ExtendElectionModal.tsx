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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

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
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extend-election-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-theme-surface-border">
          <h3 id="extend-election-modal-title" className="text-lg font-medium text-theme-text-primary">Extend Election Time</h3>
        </div>

        <div className="px-6 py-4">
          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3" role="alert" aria-live="assertive">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary">
                Current End Time
              </label>
              <div className="mt-1 text-sm text-theme-text-primary">
                {formatDateTime(currentEndDate, timezone)}
              </div>
            </div>

            <div>
              <label htmlFor="extend-new-end-time" className="block text-sm font-medium text-theme-text-secondary">
                New End Time
              </label>
              <DateTimeQuarterHour
                id="extend-new-end-time"
                value={newEndDate}
                onChange={(val) => setNewEndDate(val)}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              />

              <div className="mt-2">
                <p className="text-xs text-theme-text-muted mb-2">Quick extend:</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => extendByHours(1)}
                    className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded-sm hover:bg-theme-surface-hover"
                  >
                    +1 Hour
                  </button>
                  <button
                    type="button"
                    onClick={() => extendByHours(2)}
                    className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded-sm hover:bg-theme-surface-hover"
                  >
                    +2 Hours
                  </button>
                  <button
                    type="button"
                    onClick={() => extendByHours(4)}
                    className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded-sm hover:bg-theme-surface-hover"
                  >
                    +4 Hours
                  </button>
                  <button
                    type="button"
                    onClick={() => extendToEndOfDay()}
                    className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-sm hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/30"
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
              className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(newEndDate)}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
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
