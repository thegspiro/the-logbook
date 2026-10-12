/**
 * "Doing pre-shift work?" — offered on the vehicle check-in screen while the
 * member's shift is not yet open for check-in.
 *
 * The member picks which upcoming shift the prep is for (the one on the
 * scanned vehicle is preselected), and starting it begins a timed session that
 * the next scan ends. Nothing is credited until an officer approves it.
 */

import React, { useState } from 'react';
import { Loader2, Timer } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../services/api';
import type { PreShiftEligibleShift, PreShiftWorkSession } from '../services/api';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCalendarDate, formatTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

interface PreShiftWorkOfferProps {
  shifts: PreShiftEligibleShift[];
  apparatusId?: string | undefined;
  onStarted: (session: PreShiftWorkSession) => void;
}

const shiftLabel = (shift: PreShiftEligibleShift): string =>
  [shift.apparatus_unit_number, shift.apparatus_name].filter(Boolean).join(' — ') || 'Shift';

const PreShiftWorkOffer: React.FC<PreShiftWorkOfferProps> = ({ shifts, apparatusId, onStarted }) => {
  const tz = useTimezone();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(shifts[0]?.id ?? '');
  const [starting, setStarting] = useState(false);

  if (shifts.length === 0) return null;
  // The list reloads after a session ends, so a remembered pick can name a
  // shift that is no longer offered; fall back to the first one listed.
  const target = shifts.some((s) => s.id === selected) ? selected : (shifts[0]?.id ?? '');

  const handleStart = async () => {
    if (!target) return;
    setStarting(true);
    try {
      const session = await schedulingService.startPreShiftWork(target, apparatusId || undefined);
      toast.success('Pre-shift work started. Scan the vehicle again when you finish.');
      onStarted(session);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not start pre-shift work'));
    } finally {
      setStarting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/40 px-6 py-3 text-base font-semibold text-violet-700 transition-colors hover:bg-violet-500/10 dark:text-violet-300"
      >
        <Timer className="h-5 w-5" aria-hidden="true" />
        Doing pre-shift work?
      </button>
    );
  }

  return (
    <fieldset className="border-theme-surface-border space-y-3 rounded-xl border p-4">
      <legend className="text-theme-text-primary px-1 text-sm font-semibold">Which shift is this work for?</legend>
      <p className="text-theme-text-muted text-xs">
        Your time is recorded from now until you scan the vehicle again, and counts once an officer approves it.
      </p>
      <div className="space-y-2">
        {shifts.map((s) => (
          <label
            key={s.id}
            className="border-theme-surface-border hover:bg-theme-surface-hover flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3"
          >
            <input
              type="radio"
              name="pre-shift-target"
              value={s.id}
              checked={target === s.id}
              onChange={() => setSelected(s.id)}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="text-theme-text-primary block font-medium">{shiftLabel(s)}</span>
              <span className="text-theme-text-muted block text-xs">
                {formatCalendarDate(s.shift_date, { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
                {formatTime(s.start_time, tz)}
                {s.end_time ? ` - ${formatTime(s.end_time, tz)}` : ''}
                {s.position ? ` · ${s.position}` : ''}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} disabled={starting} className="btn-secondary flex-1">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={starting || !target}
          className="btn-primary flex flex-1 items-center justify-center gap-2"
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Start pre-shift work
        </button>
      </div>
    </fieldset>
  );
};

export default PreShiftWorkOffer;
