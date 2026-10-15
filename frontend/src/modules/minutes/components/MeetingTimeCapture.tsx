/**
 * When the meeting began or ended, recorded where the secretary is already
 * working: on the Call to Order and Adjournment sections.
 *
 * "Record now" stamps the current minute in one tap, which is how it is used
 * live. The start can instead take the meeting's scheduled time, and either can
 * be set by hand afterwards when the secretary is writing the minutes up later.
 * The server refuses an end at or before the start; the same check here gives
 * the message before a round trip.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Clock } from 'lucide-react';
import DateTimeQuarterHour from '../../../components/ux/DateTimeQuarterHour';
import { formatForDateTimeInput, formatTime, localToUTC } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

interface MeetingTimeCaptureProps {
  kind: 'start' | 'end';
  /** The recorded time, if there is one. */
  value?: string | null | undefined;
  /** The other end of the meeting, so an end before the start is caught here. */
  otherTime?: string | null | undefined;
  /** The meeting's scheduled time; offered as the start. */
  scheduled?: string | undefined;
  timezone: string;
  canEdit: boolean;
  onSave: (iso: string | null) => Promise<void>;
}

const LABELS = {
  start: { noun: 'Called to order', recorded: 'Called to order at', picker: 'Called to order time' },
  end: { noun: 'Adjourned', recorded: 'Adjourned at', picker: 'Adjourned time' },
} as const;

/** The current moment, to the minute: a meeting is not minuted to the second. */
const nowToTheMinute = (): string => {
  const now = new Date();
  now.setSeconds(0, 0);
  return now.toISOString();
};

export const MeetingTimeCapture: React.FC<MeetingTimeCaptureProps> = ({
  kind,
  value,
  otherTime,
  scheduled,
  timezone,
  canEdit,
  onSave,
}) => {
  const labels = LABELS[kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (iso: string | null) => {
    if (iso) {
      const start = kind === 'start' ? iso : otherTime;
      const end = kind === 'end' ? iso : otherTime;
      if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
        setError(
          kind === 'end'
            ? `The meeting must be adjourned after it was called to order (${formatTime(start, timezone)}).`
            : `The meeting must be called to order before it adjourned (${formatTime(end, timezone)}).`
        );
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(iso);
      setEditing(false);
    } catch (err: unknown) {
      const message = getErrorMessage(err, `Failed to record the time`);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setDraft(formatForDateTimeInput(value ?? scheduled ?? nowToTheMinute(), timezone));
    setError(null);
    setEditing(true);
  };

  if (!canEdit && !value) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <Clock className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
      {editing ? (
        <>
          <DateTimeQuarterHour value={draft} onChange={setDraft} timezone={timezone} timeLabel={labels.picker} />
          <button
            type="button"
            disabled={saving || !draft}
            onClick={() => {
              void save(localToUTC(draft, timezone));
            }}
            className="btn-primary"
          >
            {saving ? 'Saving…' : 'Save time'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="btn-secondary">
            Cancel
          </button>
        </>
      ) : value ? (
        <>
          <span className="text-theme-text-primary font-medium">
            {labels.recorded} {formatTime(value, timezone)}
          </span>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={startEditing}
                aria-label={`Change the ${labels.noun.toLowerCase()} time`}
                className="touch:min-h-11 text-blue-700 hover:underline dark:text-blue-400"
              >
                Change
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void save(null);
                }}
                aria-label={`Clear the ${labels.noun.toLowerCase()} time`}
                className="text-theme-text-muted touch:min-h-11 hover:underline"
              >
                Clear
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <span className="text-theme-text-muted">{labels.noun} time not recorded.</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void save(nowToTheMinute());
            }}
            className="btn-secondary"
          >
            Record now
          </button>
          {kind === 'start' && scheduled && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                void save(scheduled);
              }}
              className="btn-secondary"
            >
              Use scheduled time ({formatTime(scheduled, timezone)})
            </button>
          )}
          <button
            type="button"
            onClick={startEditing}
            className="touch:min-h-11 text-blue-700 hover:underline dark:text-blue-400"
          >
            Set a time…
          </button>
        </>
      )}
      {error && (
        <p className="alert-danger w-full text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default MeetingTimeCapture;
