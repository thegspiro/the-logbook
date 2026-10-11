/**
 * A member's running pre-shift session, shown first on the check-in screen.
 *
 * Scanning the vehicle again lands here, so ending the session is the
 * "scan out". The time then waits for an officer's approval.
 */

import React, { useState } from 'react';
import { Loader2, Square, Timer } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../services/api';
import type { PreShiftWorkSession } from '../services/api';
import { formatDuration } from '../../admin-hours/utils/formatDuration';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCalendarDate, formatTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

interface ActivePreShiftWorkCardProps {
  session: PreShiftWorkSession;
  onEnded: (session: PreShiftWorkSession) => void;
}

const ActivePreShiftWorkCard: React.FC<ActivePreShiftWorkCardProps> = ({ session, onEnded }) => {
  const tz = useTimezone();
  const [note, setNote] = useState('');
  const [ending, setEnding] = useState(false);

  const handleEnd = async () => {
    setEnding(true);
    try {
      const ended = await schedulingService.endPreShiftWork(session.id, note);
      toast.success(
        `Pre-shift work recorded (${formatDuration(ended.duration_minutes ?? 0)}). An officer will review it.`
      );
      onEnded(ended);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not end pre-shift work'));
    } finally {
      setEnding(false);
    }
  };

  const shiftName = session.shift_apparatus_name || 'your shift';

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg bg-violet-500/10 p-3">
        <Timer className="mt-0.5 h-5 w-5 text-violet-700 dark:text-violet-300" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-violet-800 dark:text-violet-200">Pre-shift work in progress</p>
          <p className="text-theme-text-muted text-xs">
            For {shiftName}
            {session.shift_date
              ? ` on ${formatCalendarDate(session.shift_date, { weekday: 'short', month: 'short', day: 'numeric' })}`
              : ''}
            {session.shift_start_time ? ` at ${formatTime(session.shift_start_time, tz)}` : ''}. Started{' '}
            {formatTime(session.started_at, tz)}.
          </p>
        </div>
      </div>
      <div>
        <label htmlFor="pre-shift-note" className="form-label">
          What did you do? <span className="text-theme-text-muted font-normal">(optional)</span>
        </label>
        <textarea
          id="pre-shift-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          rows={2}
          className="form-input"
          placeholder="e.g. Start-of-shift equipment check"
        />
      </div>
      <button
        type="button"
        onClick={() => void handleEnd()}
        disabled={ending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-800 px-6 py-4 text-lg font-semibold text-white transition-colors hover:bg-red-900 disabled:opacity-50"
      >
        {ending ? <Loader2 className="h-6 w-6 animate-spin" /> : <Square className="h-6 w-6" aria-hidden="true" />}
        End pre-shift work
      </button>
    </div>
  );
};

export default ActivePreShiftWorkCard;
