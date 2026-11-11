import React from 'react';
import { Lock } from 'lucide-react';
import type { EventFormModel } from '../useEventFormModel';

interface NoticesSectionProps {
  model: Pick<EventFormModel, 'error' | 'attendanceLocked' | 'lockNoticeId' | 'initialRecurrence'>;
  /**
   * Which notices to draw. A form that places the lock notice above its step
   * indicator, so every step opens under it, draws the two apart.
   */
  show?: 'all' | 'error' | 'lock' | undefined;
  /**
   * The lock notice's explanation, for a form that locks more than this one
   * does. Must carry `model.lockNoticeId`: the locked controls are described
   * by it.
   */
  lockBody?: React.ReactNode;
}

/** The form's error summary and, on a finalized event, why some fields are locked. */
export const NoticesSection: React.FC<NoticesSectionProps> = ({ model, show = 'all', lockBody }) => {
  const { error, attendanceLocked, lockNoticeId, initialRecurrence } = model;
  return (
    <>
      {show !== 'lock' && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Disabled controls leave the tab order, so the reason they are locked
          comes first in reading order rather than beside them. */}
      {show !== 'error' && attendanceLocked && (
        <div className="alert-warning flex items-start gap-3">
          <Lock className="text-theme-alert-warning-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-theme-alert-warning-title text-sm font-semibold">
              Attendance for this event is finalized
            </p>
            {lockBody ?? (
              <>
                <p id={lockNoticeId} className="text-theme-alert-warning-text text-sm">
                  Its type, category, schedule and check-in rules are locked because members&apos; credited hours were
                  calculated from them. Everything else can still be edited. To change a locked setting, someone who can
                  reopen attendance reopens it from the event page first.
                </p>
                {initialRecurrence?.is_recurring && (
                  <p className="text-theme-alert-warning-text text-sm">
                    To change these for later events in the series, edit one whose attendance is still open.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
