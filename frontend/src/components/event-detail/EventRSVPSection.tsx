/**
 * EventRSVPSection
 *
 * Renders the attendance list (for managers) with per-attendee actions such as
 * check-in, edit times, and remove. Also shows the collapsible RSVP Activity
 * history feed.
 *
 * Each attendee is one line. A row used to carry its email and two or three
 * always-visible actions, which made a 14-person meeting 42 buttons tall; the
 * one action a row is opened for, Check In, stays on the row and the rest sit
 * behind its menu with the email.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Printer, Download, History as HistoryIcon, MoreVertical, Users } from 'lucide-react';
import { getRSVPStatusLabel, getRSVPStatusColor } from '../../utils/eventHelpers';
import { formatTime, formatDateTime } from '../../utils/dateFormatting';
import { RSVPStatus as RSVPStatusEnum } from '../../constants/enums';
import { Collapsible, EmptyState } from '../ux';
import type { RSVP, RSVPHistory } from '../../types/event';

const RSVP_STATUS_VALUES: readonly string[] = Object.values(RSVPStatusEnum);

function isRSVPStatus(value: string): value is RSVPStatusEnum {
  return RSVP_STATUS_VALUES.includes(value);
}

/**
 * History rows store the raw status, and the activity feed printed it as-is
 * ("changed from going to not_going"). An unrecognised value is shown
 * verbatim rather than dropped.
 */
function rsvpStatusText(status: string | null): string {
  if (!status) return '';
  return isRSVPStatus(status) ? getRSVPStatusLabel(status) : status;
}

const PAGE_SIZE = 25;
/** Below this a roster is read at a glance and a search box is only clutter. */
const SEARCH_THRESHOLD = 8;

const ROSTER_FILTERS = ['all', 'checked_in', 'not_checked_in'] as const;
type RosterFilter = (typeof ROSTER_FILTERS)[number];

const menuItemClass =
  'touch-target-phone text-theme-text-secondary hover:bg-theme-surface-hover w-full justify-start px-4 py-2 text-left text-sm';

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
  /**
   * Attendance is closed. The roster stays readable and exportable — that is
   * the point of finalizing — but the per-row writes are gone, because the API
   * refuses all of them.
   */
  attendanceFinalized?: boolean;
  /**
   * Server-decided (`can_correct_attendance_times`). False for an organizer on
   * a Training event, where times and credited hours are a training manager's
   * or an event manager's to correct, so Edit Times is not offered.
   */
  canCorrectTimes?: boolean;
  /**
   * A row whose attendance the viewer may not write: an organizer's own, since
   * someone else vouches for them. Its check-in and row actions are hidden.
   */
  readOnlyUserId?: string | undefined;
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
  attendanceFinalized = false,
  canCorrectTimes = true,
  readOnlyUserId,
}) => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);
  const openMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenuUserId === null) return undefined;
    const handleClickOutside = (e: MouseEvent) => {
      if (openMenuRef.current && !openMenuRef.current.contains(e.target as Node)) {
        setOpenMenuUserId(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuUserId(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openMenuUserId]);

  const checkedInCount = rsvps.filter((r) => r.checked_in).length;
  const filterLabels: Record<RosterFilter, string> = {
    all: `All (${rsvps.length})`,
    checked_in: `Checked in (${checkedInCount})`,
    not_checked_in: `Not checked in (${rsvps.length - checkedInCount})`,
  };
  const showSearch = rsvps.length > SEARCH_THRESHOLD;
  // With nobody checked in the three filters name the same list twice and an
  // empty one, so they wait for the first check-in.
  const showFilters = checkedInCount > 0;

  const needle = query.trim().toLowerCase();
  const matchingRsvps = rsvps.filter((r) => {
    if (filter === 'checked_in' && !r.checked_in) return false;
    if (filter === 'not_checked_in' && r.checked_in) return false;
    if (!needle) return true;
    return r.user_name?.toLowerCase().includes(needle) || r.user_email?.toLowerCase().includes(needle);
  });
  const visibleRsvps = matchingRsvps.slice(0, visibleCount);
  const hasMore = visibleCount < matchingRsvps.length;

  return (
    <>
      {/* Attendance List */}
      <div className="card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-theme-text-primary text-lg font-medium">Attendance ({rsvps.length})</h2>
          {rsvps.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={onPrintRoster}
                className="text-theme-text-secondary hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              >
                <Printer className="h-4 w-4" />
                Print Roster
              </button>
              <button
                onClick={onExportCSV}
                className="text-theme-text-secondary hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          )}
        </div>
        {rsvps.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title="No RSVPs yet"
            description="No one has responded to this event yet."
            headingLevel={3}
          />
        ) : (
          <>
            {(showSearch || showFilters) && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {showSearch && (
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    placeholder="Search attendees"
                    aria-label="Search attendees"
                    className="form-input w-full sm:w-64"
                  />
                )}
                {showFilters &&
                  ROSTER_FILTERS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filter === value}
                      onClick={() => {
                        setFilter(value);
                        setVisibleCount(PAGE_SIZE);
                      }}
                      className={`touch-target-phone rounded-full border px-3 py-1 text-xs font-medium ${
                        filter === value
                          ? 'border-theme-text-primary bg-theme-surface-secondary text-theme-text-primary'
                          : 'border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary'
                      }`}
                    >
                      {filterLabels[value]}
                    </button>
                  ))}
              </div>
            )}
            {matchingRsvps.length === 0 && (
              <p className="text-theme-text-muted py-4 text-center text-sm">No attendees match.</p>
            )}
            <ul className="divide-theme-surface-border divide-y">
              {visibleRsvps.map((rsvp) => {
                const effectiveCheckIn = rsvp.override_check_in_at || rsvp.checked_in_at;
                const effectiveCheckOut = rsvp.override_check_out_at || rsvp.checked_out_at;
                const effectiveDuration = rsvp.override_duration_minutes ?? rsvp.attendance_duration_minutes;
                const isRemoving = removeConfirmUserId === rsvp.user_id;
                const canWriteRow = !attendanceFinalized && rsvp.user_id !== readOnlyUserId;
                const isMenuOpen = openMenuUserId === rsvp.user_id;
                const hasMenu = canWriteRow || Boolean(rsvp.user_email);
                // Checked In says everything Going does, so it takes its place
                // rather than sitting beside it. Any other answer keeps its
                // badge: a "Maybe" who turned up is worth seeing as one.
                const showStatus = !(rsvp.checked_in && rsvp.status === RSVPStatusEnum.GOING);

                return (
                  <li key={rsvp.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="text-theme-text-primary min-w-0 flex-1 text-sm font-medium break-words">
                        {rsvp.user_name}
                        {rsvp.guest_count > 0 && (
                          <span className="text-theme-text-muted ml-2 text-xs font-normal">
                            +{rsvp.guest_count} guest{rsvp.guest_count > 1 ? 's' : ''}
                          </span>
                        )}
                      </p>

                      {/* Last on a phone, where it takes a line of its own
                          under the name; in the row from sm up. */}
                      {rsvp.checked_in && (
                        <div className="text-theme-text-muted order-last flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:order-none sm:basis-auto">
                          {effectiveCheckIn && <span>In: {formatTime(effectiveCheckIn, timezone)}</span>}
                          {effectiveCheckOut && <span>Out: {formatTime(effectiveCheckOut, timezone)}</span>}
                          {effectiveDuration != null && <span>Duration: {effectiveDuration} min</span>}
                          {rsvp.override_check_in_at && (
                            <span className="text-[10px] text-amber-500">(times edited)</span>
                          )}
                          {/* Their credited time already starts at the event's
                              scheduled start, so this is not a correction to
                              make — it is here so an organizer can spot the
                              member who really was working beforehand and edit
                              their times to credit it. */}
                          {!rsvp.override_check_in_at &&
                            rsvp.early_check_in_minutes != null &&
                            rsvp.early_check_in_minutes > 0 && (
                              <span
                                className="text-[10px] text-yellow-700 dark:text-yellow-400"
                                title="Credited from the event's scheduled start. Edit times if this member was working before then."
                              >
                                (tapped in {rsvp.early_check_in_minutes} min early)
                              </span>
                            )}
                        </div>
                      )}

                      {showStatus && (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRSVPStatusColor(rsvp.status)}`}
                        >
                          {getRSVPStatusLabel(rsvp.status)}
                        </span>
                      )}
                      {rsvp.checked_in && (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-500/20 dark:text-green-400">
                          Checked In
                        </span>
                      )}
                      {rsvp.status === RSVPStatusEnum.GOING && !rsvp.checked_in && canWriteRow && (
                        <button
                          onClick={() => {
                            onCheckIn(rsvp.user_id);
                          }}
                          className="touch-target-phone text-xs text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        >
                          Check In
                        </button>
                      )}

                      {hasMenu && (
                        <div className="relative" ref={isMenuOpen ? openMenuRef : undefined}>
                          <button
                            type="button"
                            aria-label={`Actions for ${rsvp.user_name ?? 'attendee'}`}
                            aria-expanded={isMenuOpen}
                            onClick={() => setOpenMenuUserId(isMenuOpen ? null : rsvp.user_id)}
                            className="btn-icon text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover"
                          >
                            <MoreVertical className="h-4 w-4" aria-hidden="true" />
                          </button>
                          {isMenuOpen && (
                            <div className="popover-panel absolute top-full right-0 z-20 mt-1 w-64 py-1">
                              {rsvp.user_email && (
                                <p className="text-theme-text-muted px-4 py-2 text-xs break-all">{rsvp.user_email}</p>
                              )}
                              {canWriteRow && canCorrectTimes && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuUserId(null);
                                    onOpenOverrideModal(rsvp);
                                  }}
                                  className={menuItemClass}
                                >
                                  Edit Times
                                </button>
                              )}
                              {canWriteRow && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuUserId(null);
                                    onSetRemoveConfirmUserId(rsvp.user_id);
                                  }}
                                  className={`${menuItemClass} text-red-700 dark:text-red-400`}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {canWriteRow && isRemoving && (
                      <div className="mt-1 flex items-center gap-3">
                        <span className="text-theme-text-secondary text-xs">Remove {rsvp.user_name}?</span>
                        <button
                          onClick={() => {
                            onRemoveAttendee(rsvp.user_id);
                          }}
                          className="touch-target-phone text-xs font-medium text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => onSetRemoveConfirmUserId(null)}
                          className="touch-target-phone text-theme-text-muted hover:text-theme-text-secondary text-xs"
                        >
                          No
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="mt-3 w-full py-2 text-center text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                Show more ({matchingRsvps.length - visibleCount} remaining)
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
          className="bg-theme-surface shadow-sm backdrop-blur-xs"
        >
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {rsvpHistory.map((entry) => {
              const userName = entry.user_name || 'Unknown';
              const isInitial = !entry.old_status;
              const changerLabel = entry.changer_name ? `by ${entry.changer_name}` : '';

              return (
                <div
                  key={entry.id}
                  className="border-theme-surface-border flex items-start gap-3 border-b py-2 last:border-0"
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <div className="h-2 w-2 rounded-full bg-indigo-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary text-sm">
                      <span className="font-medium">{userName}</span>
                      {entry.is_automatic ? (
                        <>
                          {' '}
                          was moved from <span className="font-medium">{rsvpStatusText(entry.old_status)}</span> to{' '}
                          <span className="font-medium">{rsvpStatusText(entry.new_status)}</span>{' '}
                          <span className="text-theme-text-muted">(automatically, when a spot opened up)</span>
                        </>
                      ) : isInitial ? (
                        <>
                          {' '}
                          RSVP&apos;d as <span className="font-medium">{rsvpStatusText(entry.new_status)}</span>
                        </>
                      ) : (
                        <>
                          {' '}
                          changed from <span className="font-medium">{rsvpStatusText(entry.old_status)}</span> to{' '}
                          <span className="font-medium">{rsvpStatusText(entry.new_status)}</span>
                        </>
                      )}
                      {changerLabel && <span className="text-theme-text-muted"> ({changerLabel})</span>}
                    </p>
                    <p className="text-theme-text-muted mt-0.5 text-xs">{formatDateTime(entry.changed_at, timezone)}</p>
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
