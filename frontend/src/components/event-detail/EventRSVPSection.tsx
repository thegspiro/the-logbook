/**
 * EventRSVPSection
 *
 * Renders the attendance list (for managers) with per-attendee actions such as
 * check-in, edit times, and remove. Also shows the collapsible RSVP Activity
 * history feed.
 */

import React, { useState } from 'react';
import { Printer, Download, History as HistoryIcon, Users } from 'lucide-react';
import { getRSVPStatusLabel, getRSVPStatusColor } from '../../utils/eventHelpers';
import { formatTime, formatDateTime } from '../../utils/dateFormatting';
import { RSVPStatus as RSVPStatusEnum } from '../../constants/enums';
import { Collapsible, EmptyState } from '../ux';
import type { RSVP, RSVPHistory } from '../../types/event';

const PAGE_SIZE = 25;

export interface EventRSVPSectionProps {
  rsvps: RSVP[];
  rsvpHistory: RSVPHistory[];
  timezone: string;
  removeConfirmUserId: string | null;
  onSetRemoveConfirmUserId: (userId: string | null) => void;
  onCheckIn: (userId: string) => void;
  onOpenOverrideModal: (rsvp: RSVP) => void;
  onRemoveAttendee: (userId: string) => void;
  onPrintRoster: () => void;
  onExportCSV: () => void;
}

export const EventRSVPSection: React.FC<EventRSVPSectionProps> = ({
  rsvps,
  rsvpHistory,
  timezone,
  removeConfirmUserId,
  onSetRemoveConfirmUserId,
  onCheckIn,
  onOpenOverrideModal,
  onRemoveAttendee,
  onPrintRoster,
  onExportCSV,
}) => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visibleRsvps = rsvps.slice(0, visibleCount);
  const hasMore = visibleCount < rsvps.length;

  return (
    <>
      {/* Attendance List */}
      <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-theme-text-primary">Attendance ({rsvps.length})</h2>
          {rsvps.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={onPrintRoster}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface rounded-md transition-colors"
              >
                <Printer className="h-4 w-4" />
                Print Roster
              </button>
              <button
                onClick={onExportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface rounded-md transition-colors"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          )}
        </div>
        {rsvps.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No RSVPs yet"
            description="No one has responded to this event yet."
          />
        ) : (
          <>
            <div className="space-y-3">
              {visibleRsvps.map((rsvp) => {
                const effectiveCheckIn = rsvp.override_check_in_at || rsvp.checked_in_at;
                const effectiveCheckOut = rsvp.override_check_out_at || rsvp.checked_out_at;
                const effectiveDuration = rsvp.override_duration_minutes ?? rsvp.attendance_duration_minutes;
                const isRemoving = removeConfirmUserId === rsvp.user_id;

                return (
                  <div key={rsvp.id} className="p-3 bg-theme-surface-secondary rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-theme-text-primary">{rsvp.user_name}</p>
                        <p className="text-xs text-theme-text-muted">{rsvp.user_email}</p>
                        {rsvp.guest_count > 0 && (
                          <p className="text-xs text-theme-text-muted mt-0.5">+{rsvp.guest_count} guest{rsvp.guest_count > 1 ? 's' : ''}</p>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRSVPStatusColor(rsvp.status)}`}>
                          {getRSVPStatusLabel(rsvp.status)}
                        </span>
                        {rsvp.status === RSVPStatusEnum.GOING && !rsvp.checked_in && (
                          <button
                            onClick={() => { onCheckIn(rsvp.user_id); }}
                            className="text-xs text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                          >
                            Check In
                          </button>
                        )}
                        {rsvp.checked_in && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400">
                            Checked In
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Attendance times */}
                    {rsvp.checked_in && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-muted">
                        {effectiveCheckIn && (
                          <span>In: {formatTime(effectiveCheckIn, timezone)}</span>
                        )}
                        {effectiveCheckOut && (
                          <span>Out: {formatTime(effectiveCheckOut, timezone)}</span>
                        )}
                        {effectiveDuration != null && (
                          <span>Duration: {effectiveDuration} min</span>
                        )}
                        {rsvp.override_check_in_at && (
                          <span className="text-amber-500 text-[10px]">(times overridden)</span>
                        )}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={() => onOpenOverrideModal(rsvp)}
                        className="text-xs text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                      >
                        Edit Times
                      </button>
                      {!isRemoving ? (
                        <button
                          onClick={() => onSetRemoveConfirmUserId(rsvp.user_id)}
                          className="text-xs text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                        >
                          Remove
                        </button>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-theme-text-muted">Remove?</span>
                          <button
                            onClick={() => { onRemoveAttendee(rsvp.user_id); }}
                            className="text-xs font-medium text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => onSetRemoveConfirmUserId(null)}
                            className="text-xs text-theme-text-muted hover:text-theme-text-secondary"
                          >
                            No
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {hasMore && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="mt-3 w-full text-center text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 py-2"
              >
                Show more ({rsvps.length - visibleCount} remaining)
              </button>
            )}
          </>
        )}
      </div>

      {/* RSVP Activity */}
      {rsvpHistory.length > 0 && (
        <Collapsible
          title={
            <span className="flex items-center gap-2">
              <HistoryIcon className="h-4 w-4" />
              RSVP Activity ({rsvpHistory.length})
            </span>
          }
          className="bg-theme-surface backdrop-blur-xs shadow-sm"
        >
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {rsvpHistory.map((entry) => {
              const userName = entry.user_name || 'Unknown';
              const isInitial = !entry.old_status;
              const changerLabel = entry.changer_name
                ? `by ${entry.changer_name}`
                : '';

              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 py-2 border-b border-theme-surface-border last:border-0"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="h-2 w-2 rounded-full bg-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-theme-text-primary">
                      <span className="font-medium">{userName}</span>
                      {isInitial ? (
                        <> RSVP&apos;d as <span className="font-medium">{entry.new_status}</span></>
                      ) : (
                        <> changed from <span className="font-medium">{entry.old_status}</span> to <span className="font-medium">{entry.new_status}</span></>
                      )}
                      {changerLabel && (
                        <span className="text-theme-text-muted"> ({changerLabel})</span>
                      )}
                    </p>
                    <p className="text-xs text-theme-text-muted mt-0.5">
                      {formatDateTime(entry.changed_at, timezone)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Collapsible>
      )}
    </>
  );
};
