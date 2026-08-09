/**
 * ActiveSessionsTab Component
 *
 * Active clock-in sessions admin view. Shows all currently active sessions
 * across the organization with force clock out capability.
 */

import React from 'react';
import { Timer, StopCircle, RefreshCw } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import { formatDuration } from '../utils/formatDuration';
import { formatTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import toast from 'react-hot-toast';

import { useConfirm } from '../../../contexts/ConfirmContext';
const ActiveSessionsTab: React.FC = () => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const activeSessions = useAdminHoursStore((s) => s.activeSessions);
  const activeSessionsLoading = useAdminHoursStore((s) => s.activeSessionsLoading);
  const fetchActiveSessions = useAdminHoursStore((s) => s.fetchActiveSessions);
  const forceClockOut = useAdminHoursStore((s) => s.forceClockOut);

  const handleForceClockOut = async (entryId: string, userName: string) => {
    if (
      !(await confirm({
        title: 'End this session?',
        message: `Clocks ${userName} out now. The entry moves to pending review rather than being discarded.`,
        confirmLabel: 'End session',
        cancelLabel: 'Leave it running',
        variant: 'warning',
      }))
    )
      return;
    try {
      await forceClockOut(entryId);
      toast.success(`${userName}'s session has been ended`);
    } catch {
      // error handled by store
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-theme-text-primary text-xl font-semibold">Active Sessions</h2>
        <button
          onClick={() => {
            void fetchActiveSessions();
          }}
          className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
      {activeSessionsLoading ? (
        <div className="text-theme-text-secondary py-8 text-center">Loading active sessions...</div>
      ) : activeSessions.length === 0 ? (
        <div className="bg-theme-surface rounded-lg py-12 text-center">
          <Timer className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-secondary">No active sessions right now</p>
          <p className="text-theme-text-muted mt-1 text-sm">Sessions appear here when members are clocked in</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeSessions.map((session) => {
            const isOverLimit =
              session.maxSessionMinutes !== null && session.elapsedMinutes >= session.maxSessionMinutes;
            const isNearLimit =
              !isOverLimit &&
              session.maxSessionMinutes !== null &&
              session.elapsedMinutes >= session.maxSessionMinutes * 0.8;
            return (
              <div
                key={session.id}
                className={`bg-theme-surface rounded-lg border-l-4 p-4 shadow-md ${
                  isOverLimit ? 'border-l-red-500' : isNearLimit ? 'border-l-orange-500' : 'border-l-blue-500'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="relative shrink-0">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full ${
                          isOverLimit ? 'bg-red-500/20' : isNearLimit ? 'bg-orange-500/20' : 'bg-blue-500/20'
                        }`}
                      >
                        <Timer
                          className={`h-5 w-5 ${
                            isOverLimit
                              ? 'text-red-700 dark:text-red-400'
                              : isNearLimit
                                ? 'text-orange-700 dark:text-orange-400'
                                : 'text-blue-700 dark:text-blue-400'
                          }`}
                        />
                      </div>
                      <span className="border-theme-surface absolute -top-0.5 -right-0.5 h-3 w-3 animate-pulse rounded-full border-2 bg-green-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className="text-theme-text-primary font-semibold">{session.userName}</span>
                        <span className="text-theme-text-muted">-</span>
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: session.categoryColor ?? '#6B7280' }}
                          />
                          <span className="text-theme-text-secondary text-sm">{session.categoryName}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span
                          className={`font-medium ${
                            isOverLimit
                              ? 'text-red-700 dark:text-red-400'
                              : isNearLimit
                                ? 'text-orange-700 dark:text-orange-400'
                                : 'text-blue-700 dark:text-blue-400'
                          }`}
                        >
                          {formatDuration(session.elapsedMinutes)}
                        </span>
                        <span className="text-theme-text-muted">Started {formatTime(session.clockInAt, tz)}</span>
                        {session.maxSessionMinutes !== null && (
                          <span className="text-theme-text-muted">
                            Limit: {formatDuration(session.maxSessionMinutes)}
                          </span>
                        )}
                        {isOverLimit && (
                          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                            Over limit
                          </span>
                        )}
                        {isNearLimit && (
                          <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-400">
                            Near limit
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      void handleForceClockOut(session.id, session.userName);
                    }}
                    className="flex shrink-0 items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                    title="End this session on behalf of the member"
                  >
                    <StopCircle className="h-4 w-4" />
                    End Session
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ActiveSessionsTab;
