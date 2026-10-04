import React, { useState, useCallback } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useConfirm } from '../../contexts/ConfirmContext';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { formatDateTime, formatForDateTimeInput, getTodayLocalDate, localToUTC } from '../../utils/dateFormatting';

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
  const dialogRef = useDialog<HTMLDivElement>({ onClose });
  const { confirm } = useConfirm();

  const [newEndDate, setNewEndDate] = useState('');

  // Compared as instants: the picker holds org-zone wall time while
  // `currentEndDate` is UTC, so a string comparison calls the same moment
  // "different" across the offset.
  const newEndMs = newEndDate ? new Date(localToUTC(newEndDate, timezone)).getTime() : Number.NaN;
  const currentEndMs = new Date(currentEndDate).getTime();
  const hasNewEnd = Number.isFinite(newEndMs);
  const isPast = hasNewEnd && newEndMs <= Date.now();
  const isUnchanged = hasNewEnd && newEndMs === currentEndMs;
  const shortens = hasNewEnd && !isPast && newEndMs < currentEndMs;
  const canSubmit = hasNewEnd && !isPast && !isUnchanged;

  const validationMessage = isPast
    ? 'That time has already passed. Voting cannot end in the past.'
    : isUnchanged
      ? 'This is the current end time; pick a later one to extend voting.'
      : shortens
        ? 'Earlier than the current end: this shortens the voting window instead of extending it.'
        : null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (shortens) {
      // The server accepts an earlier end without comment and nobody is
      // re-notified, so shortening has to be a deliberate decision (W50-26).
      const ok = await confirm({
        title: 'Shorten the voting window?',
        message: `Voting currently closes ${formatDateTime(currentEndDate, timezone)}. Ending it at ${formatDateTime(
          new Date(newEndMs),
          timezone
        )} instead cuts the window short, and members who planned to vote before the original close will lose their chance.`,
        confirmLabel: 'Shorten voting window',
        cancelLabel: 'Keep current end',
        variant: 'warning',
      });
      if (!ok) return;
    }
    onSubmit(newEndDate);
  };

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
    // End of the department's day, not the browser's: take the calendar date
    // as rendered in the org zone and pin 23:59 to it.
    const currentDay = formatForDateTimeInput(currentEndDate, timezone).split('T')[0] ?? '';
    setNewEndDate(`${currentDay}T23:59`);
  };

  return (
    <div
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extend-election-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div ref={dialogRef} className="modal-panel modal-panel-scroll w-full max-w-md">
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
                timeLabel="New end time"
                value={newEndDate}
                onChange={(val) => setNewEndDate(val)}
                className="form-input mt-1 shadow-xs"
                min={getTodayLocalDate(timezone)}
                timezone={timezone}
              />
              {validationMessage && (
                <p
                  data-testid="extend-end-validation"
                  className={`mt-1 text-xs ${shortens ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}
                >
                  {validationMessage}
                </p>
              )}

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
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!canSubmit}
              className="rounded-md bg-purple-600 px-4 py-2 text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {shortens ? 'Shorten Election' : 'Extend Election'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExtendElectionModal;
