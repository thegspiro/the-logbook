/**
 * Member Audit History Page
 *
 * Shows a chronological timeline of all changes to a member's record.
 * Accessible from the admin edit page for a specific member.
 *
 * Features:
 * - Timeline-style audit log entries
 * - Event type filtering
 * - Expandable detail sections for each entry
 * - Pagination with "Load More"
 * - Severity indicators (info, warning, critical)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { userService } from '../services/api';
import { formatDate } from '../utils/dateFormatting';
import { toDisplayString } from '../utils/displayValue';
import { useTimezone } from '../hooks/useTimezone';
import type { MemberAuditLogEntry } from '../types/user';
import type { UserWithRoles } from '../types/role';

type EventTypeFilter =
  'all' | 'profile_update' | 'status_change' | 'role_change' | 'password_reset' | 'login' | 'membership_change';

const EVENT_TYPE_OPTIONS: { value: EventTypeFilter; label: string }[] = [
  { value: 'all', label: 'All Events' },
  { value: 'profile_update', label: 'Profile Updates' },
  { value: 'status_change', label: 'Status Changes' },
  { value: 'role_change', label: 'Role Changes' },
  { value: 'password_reset', label: 'Password Resets' },
  { value: 'login', label: 'Logins' },
  { value: 'membership_change', label: 'Membership Changes' },
];

const SEVERITY_STYLES: Record<string, { dot: string; label: string }> = {
  info: { dot: 'bg-blue-500', label: 'Info' },
  warning: { dot: 'bg-yellow-500', label: 'Warning' },
  critical: { dot: 'bg-red-500', label: 'Critical' },
};

export const MemberAuditHistoryPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();

  const [user, setUser] = useState<UserWithRoles | null>(null);
  const [entries, setEntries] = useState<MemberAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>('all');
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<number>>(new Set());

  const fetchAuditHistory = useCallback(
    async (pageNum: number, eventType: EventTypeFilter, append: boolean) => {
      if (!userId) return;

      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const filterValue = eventType === 'all' ? undefined : eventType;
        const data = await userService.getMemberAuditHistory(userId, pageNum, filterValue);

        if (append) {
          setEntries((prev) => [...prev, ...data]);
        } else {
          setEntries(data);
        }

        // If fewer than 50 results returned, there are no more pages
        setHasMore(data.length >= 50);
      } catch (_err) {
        setError('Unable to load audit history. Please check your connection and try again.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;

    const loadInitialData = async () => {
      setLoading(true);
      setError(null);

      try {
        const userData = await userService.getUserWithRoles(userId);
        setUser(userData);
      } catch (_err) {
        setError('Unable to load member information.');
        setLoading(false);
        return;
      }

      await fetchAuditHistory(1, eventTypeFilter, false);
    };

    void loadInitialData();
  }, [userId, eventTypeFilter, fetchAuditHistory]);

  useEffect(() => {
    if (!userId || !user) return;

    setPage(1);
    setExpandedEntryIds(new Set());
    void fetchAuditHistory(1, eventTypeFilter, false);
  }, [eventTypeFilter, fetchAuditHistory, user, userId]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchAuditHistory(nextPage, eventTypeFilter, true);
  };

  const toggleEntryExpanded = (entryId: number) => {
    setExpandedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const getSeverityStyle = (severity: string): { dot: string; label: string } => {
    return SEVERITY_STYLES[severity] ?? { dot: 'bg-blue-500', label: 'Info' };
  };

  const formatEventDataValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return toDisplayString(value);
  };

  const formatEventDataKey = (key: string): string => {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex h-64 items-center justify-center">
            <div className="text-theme-text-primary">Loading audit history...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
          <button
            onClick={() => void navigate(`/members/admin/edit/${userId}`)}
            className="text-theme-text-muted hover:text-theme-text-primary mt-4 flex items-center gap-1 text-sm"
          >
            &larr; Back to Member Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => void navigate(`/members/admin/edit/${userId}`)}
            className="text-theme-text-muted hover:text-theme-text-primary mb-4 flex items-center gap-1 text-sm"
          >
            &larr; Back to Edit Member
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-theme-text-primary text-3xl font-bold">Audit History</h1>
              {user && <p className="text-theme-text-muted mt-1">{user.full_name || user.username}</p>}
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-theme-surface mb-6 rounded-lg p-4 shadow-sm backdrop-blur-xs">
          <div className="flex items-center gap-3">
            <label htmlFor="event-type-filter" className="text-theme-text-secondary text-sm whitespace-nowrap">
              Filter by:
            </label>
            <select
              id="event-type-filter"
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value as EventTypeFilter)}
              className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
            >
              {EVENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Error banner (non-fatal, when user is loaded but entries failed) */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/50 bg-red-500/10 p-4">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Timeline List */}
        {entries.length === 0 && !loading ? (
          <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
            <div className="py-12 text-center">
              <div className="text-theme-text-muted mb-4 text-4xl">&#128221;</div>
              <p className="text-theme-text-primary mb-2 text-lg font-semibold">No audit history found</p>
              <p className="text-theme-text-muted text-sm">
                {eventTypeFilter !== 'all'
                  ? 'No events match the selected filter. Try selecting "All Events" to see the full history.'
                  : 'There are no recorded changes for this member yet.'}
              </p>
              {eventTypeFilter !== 'all' && (
                <button
                  onClick={() => setEventTypeFilter('all')}
                  className="mt-4 text-sm text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Clear filter
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-0">
            {entries.map((entry, index) => {
              const severityStyle = getSeverityStyle(entry.severity);
              const isExpanded = expandedEntryIds.has(entry.id);
              const hasEventData = entry.event_data && Object.keys(entry.event_data).length > 0;
              const isLast = index === entries.length - 1;

              return (
                <div key={entry.id} className="relative flex gap-4">
                  {/* Timeline connector */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`mt-5 h-3 w-3 shrink-0 rounded-full ${severityStyle.dot}`}
                      title={severityStyle.label}
                    />
                    {!isLast && <div className="bg-theme-surface-border min-h-[24px] w-0.5 flex-1" />}
                  </div>

                  {/* Entry Card */}
                  <div className="mb-4 flex-1">
                    <div className="bg-theme-surface rounded-lg p-4 shadow-sm backdrop-blur-xs">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-theme-text-primary text-sm font-medium">{entry.description}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span className="text-theme-text-muted text-sm">{formatDate(entry.timestamp, tz)}</span>
                            {entry.changed_by_username && (
                              <span className="text-theme-text-secondary text-sm">by {entry.changed_by_username}</span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium ${
                                entry.severity === 'critical'
                                  ? 'text-red-700 dark:text-red-400'
                                  : entry.severity === 'warning'
                                    ? 'text-yellow-700 dark:text-yellow-400'
                                    : 'text-blue-700 dark:text-blue-400'
                              }`}
                            >
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${severityStyle.dot}`} />
                              {severityStyle.label}
                            </span>
                          </div>
                        </div>

                        {hasEventData && (
                          <button
                            onClick={() => toggleEntryExpanded(entry.id)}
                            className="text-theme-text-muted hover:text-theme-text-primary shrink-0 text-sm"
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                          >
                            {isExpanded ? '▲ Hide' : '▼ Details'}
                          </button>
                        )}
                      </div>

                      {/* Expandable Details */}
                      {isExpanded && hasEventData && (
                        <div className="border-theme-surface-border mt-3 border-t pt-3">
                          <p className="text-theme-text-muted mb-2 text-xs font-medium tracking-wider uppercase">
                            Event Data
                          </p>
                          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                            {Object.entries(entry.event_data ?? {}).map(([key, value]) => (
                              <div key={key} className="flex flex-col">
                                <span className="text-theme-text-muted text-xs">{formatEventDataKey(key)}</span>
                                <span className="text-theme-text-secondary text-sm wrap-break-word">
                                  {formatEventDataValue(value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Load More Button */}
            {hasMore && (
              <div className="flex justify-center pt-4 pb-2">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="btn-info rounded-md text-sm font-medium"
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Record count */}
        {entries.length > 0 && (
          <div className="text-theme-text-muted mt-4 text-right text-sm">
            Showing {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </div>
        )}
      </div>
    </div>
  );
};

export default MemberAuditHistoryPage;
