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

const ActiveSessionsTab: React.FC = () => {
  const tz = useTimezone();
  const activeSessions = useAdminHoursStore((s) => s.activeSessions);
  const activeSessionsLoading = useAdminHoursStore((s) => s.activeSessionsLoading);
  const fetchActiveSessions = useAdminHoursStore((s) => s.fetchActiveSessions);
  const forceClockOut = useAdminHoursStore((s) => s.forceClockOut);

  const handleForceClockOut = async (entryId: string, userName: string) => {
    if (!window.confirm(`Are you sure you want to end ${userName}'s active session? The entry will be moved to pending review.`)) return;
    try {
      await forceClockOut(entryId);
      toast.success(`${userName}'s session has been ended`);
    } catch {
      // error handled by store
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-theme-text-primary">Active Sessions</h2>
        <button
          onClick={() => { void fetchActiveSessions(); }}
          className="flex items-center gap-2 px-3 py-2 bg-theme-surface text-theme-text-secondary rounded-lg border border-theme-surface-border hover:bg-theme-surface-hover transition text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>
      {activeSessionsLoading ? (
        <div className="text-center py-8 text-theme-text-secondary">Loading active sessions...</div>
      ) : activeSessions.length === 0 ? (
        <div className="text-center py-12 bg-theme-surface rounded-lg">
          <Timer className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-secondary">No active sessions right now</p>
          <p className="text-sm text-theme-text-muted mt-1">Sessions appear here when members are clocked in</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeSessions.map((session) => {
            const isOverLimit = session.maxSessionMinutes !== null && session.elapsedMinutes >= session.maxSessionMinutes;
            const isNearLimit = !isOverLimit && session.maxSessionMinutes !== null && session.elapsedMinutes >= session.maxSessionMinutes * 0.8;
            return (
              <div
                key={session.id}
                className={`bg-theme-surface rounded-lg shadow-md p-4 border-l-4 ${
                  isOverLimit ? 'border-l-red-500' : isNearLimit ? 'border-l-orange-500' : 'border-l-blue-500'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="relative shrink-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isOverLimit ? 'bg-red-500/20' : isNearLimit ? 'bg-orange-500/20' : 'bg-blue-500/20'
                      }`}>
                        <Timer className={`w-5 h-5 ${
                          isOverLimit ? 'text-red-700 dark:text-red-400' : isNearLimit ? 'text-orange-700 dark:text-orange-400' : 'text-blue-700 dark:text-blue-400'
                        }`} />
                      </div>
                      <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full animate-pulse border-2 border-theme-surface" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-theme-text-primary">{session.userName}</span>
                        <span className="text-theme-text-muted">-</span>
                        <div className="flex items-center gap-1.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: session.categoryColor ?? '#6B7280' }}
                          />
                          <span className="text-sm text-theme-text-secondary">{session.categoryName}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className={`font-medium ${
                          isOverLimit ? 'text-red-700 dark:text-red-400' : isNearLimit ? 'text-orange-700 dark:text-orange-400' : 'text-blue-700 dark:text-blue-400'
                        }`}>
                          {formatDuration(session.elapsedMinutes)}
                        </span>
                        <span className="text-theme-text-muted">
                          Started {formatTime(session.clockInAt, tz)}
                        </span>
                        {session.maxSessionMinutes !== null && (
                          <span className="text-theme-text-muted">
                            Limit: {formatDuration(session.maxSessionMinutes)}
                          </span>
                        )}
                        {isOverLimit && (
                          <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-700 dark:text-red-400 rounded-full font-medium">
                            Over limit
                          </span>
                        )}
                        {isNearLimit && (
                          <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-700 dark:text-orange-400 rounded-full font-medium">
                            Near limit
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => { void handleForceClockOut(session.id, session.userName); }}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium shrink-0"
                    title="End this session on behalf of the member"
                  >
                    <StopCircle className="w-4 h-4" />
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
