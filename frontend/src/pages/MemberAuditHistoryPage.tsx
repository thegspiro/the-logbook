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
import { useParams, useNavigate } from 'react-router-dom';
import { userService } from '../services/api';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { MemberAuditLogEntry } from '../types/user';
import type { UserWithRoles } from '../types/role';

type EventTypeFilter =
  | 'all'
  | 'profile_update'
  | 'status_change'
  | 'role_change'
  | 'password_reset'
  | 'login'
  | 'membership_change';

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

    loadInitialData();
  }, [userId]);

  useEffect(() => {
    if (!userId || !user) return;

    setPage(1);
    setExpandedEntryIds(new Set());
    fetchAuditHistory(1, eventTypeFilter, false);
  }, [eventTypeFilter]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchAuditHistory(nextPage, eventTypeFilter, true);
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
    return (SEVERITY_STYLES[severity] || SEVERITY_STYLES.info)!;
  };

  const formatEventDataValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const formatEventDataKey = (key: string): string => {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64">
            <div className="text-theme-text-primary">Loading audit history...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 text-sm text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1"
          >
            &larr; Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate(`/members/admin/edit/${userId}`)}
            className="text-sm text-theme-text-muted hover:text-theme-text-primary mb-4 flex items-center gap-1"
          >
            &larr; Back to Edit Member
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-theme-text-primary">
                Audit History
              </h1>
              {user && (
                <p className="text-theme-text-muted mt-1">
                  {user.full_name || user.username}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <label
              htmlFor="event-type-filter"
              className="text-sm text-theme-text-secondary whitespace-nowrap"
            >
              Filter by:
            </label>
            <select
              id="event-type-filter"
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value as EventTypeFilter)}
              className="px-3 py-2 border border-theme-surface-border rounded-md text-sm text-theme-text-primary bg-theme-surface-secondary focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Timeline List */}
        {entries.length === 0 && !loading ? (
          <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-6">
            <div className="text-center py-12">
              <div className="text-theme-text-muted text-4xl mb-4">
                &#128221;
              </div>
              <p className="text-lg font-semibold text-theme-text-primary mb-2">
                No audit history found
              </p>
              <p className="text-sm text-theme-text-muted">
                {eventTypeFilter !== 'all'
                  ? 'No events match the selected filter. Try selecting "All Events" to see the full history.'
                  : 'There are no recorded changes for this member yet.'}
              </p>
              {eventTypeFilter !== 'all' && (
                <button
                  onClick={() => setEventTypeFilter('all')}
                  className="mt-4 text-sm text-blue-400 hover:text-blue-300"
                >
                  Clear filter
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-0">
            {entries.map((entry, index) => {
              const severityStyle = getSeverityStyle(entry.severity)!;
              const isExpanded = expandedEntryIds.has(entry.id);
              const hasEventData =
                entry.event_data && Object.keys(entry.event_data).length > 0;
              const isLast = index === entries.length - 1;

              return (
                <div key={entry.id} className="relative flex gap-4">
                  {/* Timeline connector */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-3 h-3 rounded-full mt-5 flex-shrink-0 ${severityStyle.dot}`}
                      title={severityStyle.label}
                    />
                    {!isLast && (
                      <div className="w-0.5 bg-theme-surface-border flex-1 min-h-[24px]" />
                    )}
                  </div>

                  {/* Entry Card */}
                  <div className="flex-1 mb-4">
                    <div className="bg-theme-surface backdrop-blur-sm shadow rounded-lg p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-theme-text-primary">
                            {entry.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                            <span className="text-sm text-theme-text-muted">
                              {formatDate(entry.timestamp, tz)}
                            </span>
                            {entry.changed_by_username && (
                              <span className="text-sm text-theme-text-secondary">
                                by {entry.changed_by_username}
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium ${
                                entry.severity === 'critical'
                                  ? 'text-red-400'
                                  : entry.severity === 'warning'
                                  ? 'text-yellow-400'
                                  : 'text-blue-400'
                              }`}
                            >
                              <span
                                className={`inline-block w-1.5 h-1.5 rounded-full ${severityStyle.dot}`}
                              />
                              {severityStyle.label}
                            </span>
                          </div>
                        </div>

                        {hasEventData && (
                          <button
                            onClick={() => toggleEntryExpanded(entry.id)}
                            className="text-sm text-theme-text-muted hover:text-theme-text-primary flex-shrink-0"
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                          >
                            {isExpanded ? '▲ Hide' : '▼ Details'}
                          </button>
                        )}
                      </div>

                      {/* Expandable Details */}
                      {isExpanded && hasEventData && (
                        <div className="mt-3 pt-3 border-t border-theme-surface-border">
                          <p className="text-xs font-medium text-theme-text-muted uppercase tracking-wider mb-2">
                            Event Data
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                            {Object.entries(entry.event_data!).map(([key, value]) => (
                              <div key={key} className="flex flex-col">
                                <span className="text-xs text-theme-text-muted">
                                  {formatEventDataKey(key)}
                                </span>
                                <span className="text-sm text-theme-text-secondary break-words">
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
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Record count */}
        {entries.length > 0 && (
          <div className="mt-4 text-sm text-theme-text-muted text-right">
            Showing {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </div>
        )}
      </div>
    </div>
  );
};

export default MemberAuditHistoryPage;
