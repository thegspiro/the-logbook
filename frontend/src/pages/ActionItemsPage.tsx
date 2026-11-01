/**
 * Action Items Page (C2)
 *
 * Unified view of action items from both Meeting and Minutes modules.
 * Allows filtering by status and source and showing items assigned to the
 * current user. `?status=` and `?source=` seed those filters, which is how the
 * operations dashboard's overdue cards link here (DASH-37).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Clock, Filter, Loader2 } from 'lucide-react';
import { dashboardService } from '../services/api';
import type { ActionItemSummary } from '../services/api';
import { minutesService } from '../modules/minutes/services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { blankToNull } from '../utils/formValues';
import { calendarDaysFromToday, formatCalendarDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useAuthStore } from '../stores/authStore';
import { EmptyState } from '../components/ux';
import { Modal } from '../components/Modal';
import { GovernancePageHeader } from '../components/governance/GovernancePageHeader';
import { actionItemStatusLabel } from '../modules/minutes/utils/actionItemStatus';

/** What an assignee may set on their own minutes action item (W52-7). */
const ASSIGNEE_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

const STATUS_BADGES: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  cancelled: 'bg-theme-surface-secondary text-theme-text-primary',
};

const PRIORITY_BADGES: Record<string, string> = {
  low: 'bg-theme-surface-secondary text-theme-text-secondary',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

// Meeting action items store priority as an integer (0=normal, 1=high,
// 2=urgent — see MeetingActionItem.priority) and the endpoint passes it through
// as "1"/"2"; minutes items already send a word. 0 never arrives, because the
// endpoint drops a falsy priority.
const MEETING_PRIORITY_LABELS: Record<string, string> = {
  '1': 'high',
  '2': 'urgent',
};

const CLOSED_STATUSES: readonly string[] = ['completed', 'cancelled'];

const isOpen = (item: ActionItemSummary): boolean => !CLOSED_STATUSES.includes(item.status);

/**
 * "Open" means not yet done, across both sources: meeting items store `open`,
 * minutes items `pending`, and both can be `in_progress` or (minutes)
 * `overdue`. Sent to the API as a status it matched exactly, "Open" found
 * meeting items only — zero rows beside an Open tile reading 3 (W52-3).
 */
const OPEN_FILTER = 'open';

/**
 * Overdue is decided by the server, with the predicate the dashboard's overdue
 * cards count by, so a card's link opens on exactly the rows it counted. It is
 * not a stored status: sent as one it would match only minutes items a person
 * had marked `overdue` by hand, which the cards never count.
 */
const OVERDUE_FILTER = 'overdue';

const STATUS_FILTERS: readonly string[] = [OPEN_FILTER, OVERDUE_FILTER, 'pending', 'in_progress', 'completed'];

type SourceFilter = '' | 'meeting' | 'minutes';

const sourceFromParam = (value: string | null): SourceFilter =>
  value === 'meeting' || value === 'minutes' ? value : '';

const statusFromParam = (value: string | null): string => (value && STATUS_FILTERS.includes(value) ? value : '');

const priorityLabel = (item: ActionItemSummary): string | undefined =>
  item.priority && item.source === 'meeting'
    ? (MEETING_PRIORITY_LABELS[item.priority] ?? item.priority)
    : item.priority;

const ActionItemsPage: React.FC = () => {
  const tz = useTimezone();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ActionItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(() => statusFromParam(searchParams.get('status')));
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(() => sourceFromParam(searchParams.get('source')));
  const [assignedToMe, setAssignedToMe] = useState(false);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [editing, setEditing] = useState<ActionItemSummary | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Only minutes items carry an assignee_id the server can match an assignee
  // on (W52-7); an item assigned by name only, or a meeting item, is not
  // offered.
  const isMine = (item: ActionItemSummary): boolean =>
    item.source === 'minutes' && !!currentUserId && item.assignee_id === currentUserId;

  const openEditor = (item: ActionItemSummary) => {
    setEditing(item);
    setEditStatus(item.status);
    setEditNotes(item.completion_notes ?? '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await minutesService.updateActionItem(editing.source_id, editing.id, {
        status: editStatus,
        completion_notes: blankToNull(editNotes),
      });
      toast.success('Action item updated');
      setEditing(null);
      await fetchItems();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the action item'));
    } finally {
      setSaving(false);
    }
  };

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const data = await dashboardService.getActionItems({
        ...(statusFilter && statusFilter !== OPEN_FILTER && statusFilter !== OVERDUE_FILTER
          ? { status_filter: statusFilter }
          : {}),
        ...(statusFilter === OVERDUE_FILTER ? { overdue: true } : {}),
        ...(sourceFilter ? { source: sourceFilter } : {}),
        ...(assignedToMe ? { assigned_to_me: assignedToMe } : {}),
      });
      setItems(statusFilter === OPEN_FILTER ? data.filter(isOpen) : data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, assignedToMe]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // A filter changed on the page drops the parameter that seeded it, so a
  // reload or a shared link does not bring back a filter the user cleared.
  const dropParam = (name: string) => {
    if (!searchParams.has(name)) return;
    const next = new URLSearchParams(searchParams);
    next.delete(name);
    setSearchParams(next, { replace: true });
  };

  // A due date is a calendar day (a meeting item's DATE, or a minutes item's
  // UTC midnight), so it is compared with today on the department's calendar.
  // Measuring it against the clock counted an item overdue from the evening
  // before it was due, anywhere west of UTC (W52-2).
  const daysUntilDue = (dueDate?: string): number | null => (dueDate ? calendarDaysFromToday(dueDate, tz) : null);

  const getDueDateClass = (dueDate?: string) => {
    const days = daysUntilDue(dueDate);
    if (days === null) return 'text-theme-text-muted';
    if (days < 0) return 'text-red-700 dark:text-red-400 font-semibold';
    if (days <= 3) return 'text-orange-700 dark:text-orange-400';
    return 'text-theme-text-secondary';
  };

  const overdue = items.filter((i) => {
    const days = daysUntilDue(i.due_date);
    return days !== null && days < 0 && isOpen(i);
  }).length;

  const open = items.filter(isOpen).length;

  return (
    <div className="mx-auto max-w-7xl">
      <GovernancePageHeader
        icon={AlertTriangle}
        title="Action Items"
        subtitle="Action items from meetings and minutes, soonest due first"
      />

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Total Items</p>
          <p className="text-theme-text-primary text-2xl font-bold">{items.length}</p>
        </div>
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Open</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{open}</p>
        </div>
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Overdue</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{overdue}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter className="text-theme-text-muted h-4 w-4" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              dropParam('status');
            }}
            aria-label="Filter action items by status"
            className="form-input-sm"
          >
            <option value="">All Statuses</option>
            <option value={OPEN_FILTER}>Open (not done)</option>
            <option value={OVERDUE_FILTER}>Overdue</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(sourceFromParam(e.target.value));
              dropParam('source');
            }}
            aria-label="Filter action items by source"
            className="form-input-sm"
          >
            <option value="">All Sources</option>
            <option value="meeting">Meetings</option>
            <option value="minutes">Minutes</option>
          </select>
        </div>
        <label className="text-theme-text-secondary touch:min-h-[44px] flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={(e) => setAssignedToMe(e.target.checked)}
            className="form-checkbox"
          />
          Assigned to me
        </label>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={statusFilter || sourceFilter || assignedToMe ? 'No matching action items' : 'No action items'}
          description={
            statusFilter || sourceFilter || assignedToMe
              ? 'Choose a different status or clear "Assigned to me" to see more.'
              : 'Action items recorded in meetings and minutes appear here.'
          }
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            // A link, not a clickable div: the row was unreachable by keyboard
            // and unannounced to a screen reader (W52-4).
            <div key={`${item.source}-${item.id}`} className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <Link
                to={item.source === 'meeting' ? '/minutes' : `/minutes/${item.source_id}`}
                className="card-secondary hover:bg-theme-surface-hover block min-w-0 flex-1 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary truncate text-sm font-medium">{item.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[item.status] || 'bg-theme-surface-secondary text-theme-text-primary'}`}
                      >
                        {actionItemStatusLabel(item.status)}
                      </span>
                      {item.priority && (
                        <span
                          className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGES[priorityLabel(item) ?? ''] || ''}`}
                        >
                          {priorityLabel(item)}
                        </span>
                      )}
                      <span className="text-theme-text-muted text-xs">
                        {item.source === 'meeting' ? 'Meeting' : 'Minutes'}
                      </span>
                      {item.assignee_name && (
                        <span className="text-theme-text-muted text-xs">{item.assignee_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {item.due_date ? (
                      <div className={`text-sm ${getDueDateClass(item.due_date)}`}>
                        <Clock className="mr-1 inline h-3 w-3" />
                        {/* A calendar day: formatting it in the department's zone
                          showed the day before (W52-1). */}
                        {formatCalendarDate(item.due_date)}
                      </div>
                    ) : (
                      <span className="text-theme-text-muted text-xs">No due date</span>
                    )}
                  </div>
                </div>
              </Link>
              {isMine(item) && (
                <button
                  type="button"
                  onClick={() => openEditor(item)}
                  aria-label={`Update status of ${item.description}`}
                  className="btn-secondary touch:min-h-11 shrink-0 self-start rounded-lg px-3 py-2 text-sm sm:self-center"
                >
                  Update status
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Update action item"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="btn-secondary rounded-lg px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving}
              className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-4">
            <p className="text-theme-text-primary text-sm">{editing.description}</p>
            <p className="text-theme-text-muted text-xs">
              As the assignee you can change the status and add completion notes. Anything else is changed by whoever
              keeps the minutes.
            </p>
            <div>
              <label htmlFor="assignee-status" className="form-label">
                Status
              </label>
              <select
                id="assignee-status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="form-input"
              >
                {ASSIGNEE_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="assignee-notes" className="form-label">
                Completion notes
              </label>
              <textarea
                id="assignee-notes"
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="form-input"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ActionItemsPage;
