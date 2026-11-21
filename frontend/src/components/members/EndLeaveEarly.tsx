/**
 * "Your leave": the member's leave in progress, and the control to end it
 * early by giving their first day back.
 *
 * Ending a leave early needs no vote: the server moves the leave's end to the
 * day before the first day back, and tells the officers who manage leave so
 * they can correct a wrong date. The server decides what may be ended (a leave
 * that has begun and not yet ended, with no request to extend it waiting);
 * this list only chooses what to offer, from the same dates.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { leaveRequestService } from '../../services/leaveRequestService';
import type { LeaveOfAbsenceResponse } from '../../services/api';
import { addCalendarDays, formatCalendarDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface Props {
  leaves: LeaveOfAbsenceResponse[];
  /** The member's today, as a YYYY-MM-DD date. */
  today: string;
  /** Called after a leave was ended, to reload what the page shows. */
  onEnded: () => Promise<void> | void;
}

const inProgress = (leave: LeaveOfAbsenceResponse, today: string): boolean =>
  leave.active && leave.start_date <= today && (leave.end_date === null || leave.end_date >= today);

const EndLeaveEarly: React.FC<Props> = ({ leaves, today, onEnded }) => {
  const { confirm } = useConfirm();
  const [openId, setOpenId] = useState<string | null>(null);
  const [firstDayBack, setFirstDayBack] = useState('');
  const [busy, setBusy] = useState(false);

  const current = leaves.filter((leave) => inProgress(leave, today));
  if (current.length === 0) return null;

  const submit = async (leave: LeaveOfAbsenceResponse) => {
    if (!firstDayBack) return;
    const lastDay = addCalendarDays(firstDayBack, -1);
    const ok = await confirm({
      title: 'End your leave early?',
      message: `Your leave will end on ${formatCalendarDate(lastDay)}, and your training requirements follow the new date. The officers who manage leave are told. Only an officer can change it after this.`,
      confirmLabel: 'End my leave',
      cancelLabel: 'Keep my leave',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await leaveRequestService.endLeaveEarly(leave.id, firstDayBack);
      toast.success(
        `Your leave now ends ${formatCalendarDate(result.end_date)}. The officers who manage leave were told.`
      );
      setOpenId(null);
      setFirstDayBack('');
      await onEnded();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Your leave was not changed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mb-6 p-4" aria-labelledby="current-leave-heading">
      <h2 id="current-leave-heading" className="text-theme-text-primary mb-3 font-semibold">
        Your leave
      </h2>
      <ul className="space-y-3">
        {current.map((leave) => {
          const id = leave.id;
          const open = openId === id;
          return (
            <li key={id} className="border-theme-surface-border rounded-md border p-3">
              <p className="text-theme-text-primary text-sm">
                On leave since {formatCalendarDate(leave.start_date)},{' '}
                {leave.end_date ? `until ${formatCalendarDate(leave.end_date)}` : 'with no end date set'}.
              </p>
              {open ? (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit(leave);
                  }}
                >
                  <label className="form-label" htmlFor={`first-day-back-${id}`}>
                    Your first day back
                  </label>
                  <input
                    id={`first-day-back-${id}`}
                    type="date"
                    className="form-input w-full sm:w-56"
                    required
                    min={addCalendarDays(leave.start_date, 1)}
                    max={leave.end_date ?? undefined}
                    aria-describedby={`first-day-back-help-${id}`}
                    value={firstDayBack}
                    onChange={(e) => setFirstDayBack(e.target.value)}
                  />
                  <p id={`first-day-back-help-${id}`} className="text-theme-text-muted text-xs">
                    Your leave ends the day before. To stay away longer, ask for leave above instead.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="btn-primary" disabled={busy || !firstDayBack}>
                      {busy ? 'Saving…' : 'End my leave'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        setOpenId(null);
                        setFirstDayBack('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="btn-secondary mt-3"
                  onClick={() => {
                    setOpenId(id);
                    setFirstDayBack('');
                  }}
                >
                  I&rsquo;m back early
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default EndLeaveEarly;
