/**
 * Action Items Page (C2)
 *
 * Every action item from meetings and minutes, soonest due first, one page at
 * a time (DASH-40), and the screen meeting action items are managed from
 * (owner decision 2026-11-01). Filters: status, source, assignee, meeting, and
 * "Assigned to me". `?status=`, `?source=`, `?assignee=` and `?meeting=` seed
 * them, which is how the dashboard tile, the operations dashboard's overdue
 * cards and the Minutes page link here (DASH-37).
 *
 * Who may do what is the backend's rule, mirrored rather than widened:
 * - a meeting item is edited, completed or deleted by a `meetings.manage`
 *   holder (`PATCH`/`DELETE /meetings/action-items/{id}`);
 * - a minutes item's status and notes are changed by a `minutes.manage`
 *   holder or by the member it is assigned to (W52-7); anything else about it
 *   is edited on its minutes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Clock, Filter, Loader2 } from 'lucide-react';
import { dashboardService, meetingsService } from '../services/api';
import type { ActionItemPage, ActionItemSummary, MeetingRecord } from '../services/api';
import { minutesService } from '../modules/minutes/services/api';
import type { ActionItemAssignee } from '../modules/minutes/types/minutes';
import { MeetingActionItemDialog } from '../modules/action-items/components/MeetingActionItemDialog';
import { getErrorMessage } from '../utils/errorHandling';
import { blankToNull } from '../utils/formValues';
import { calendarDaysFromToday, formatCalendarDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useAuthStore } from '../stores/authStore';
import { useConfirm } from '../contexts/ConfirmContext';
import { EmptyState, Pagination } from '../components/ux';
import { Modal } from '../components/Modal';
import { FormField } from '../components/ux/FormField';
import { useDiscardGuard } from '../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../utils/serverFieldErrors';
import { GovernancePageHeader } from '../components/governance/GovernancePageHeader';
import { actionItemStatusLabel } from '../modules/minutes/utils/actionItemStatus';
import { DEFAULT_PAGE_SIZE } from '../constants/config';

/** What may be set on a minutes action item from this screen (W52-7). */
const MINUTES_STATUS_OPTIONS = [
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

type ActionItemEditField = 'status' | 'completion_notes';

// ActionItemUpdate (backend/app/schemas/minute.py) sets no max_length on
// either field, so neither input carries one.
const ACTION_ITEM_EDIT_FIELDS: Record<ActionItemEditField, ServerFieldSpec> = {
  status: { label: 'Status' },
  completion_notes: { label: 'Completion notes' },
};
const ACTION_ITEM_EDIT_IDS: Record<ActionItemEditField, string> = {
  status: 'assignee-status',
  completion_notes: 'assignee-notes',
};

/**
 * Whether a row still offers "Mark complete". The counts and the Open filter
 * are the server's; this only decides which rows show the button. A carried
 * minutes item is closed here: it is worked in the minutes it was carried to.
 */
const isOpen = (item: ActionItemSummary): boolean => !CLOSED_STATUSES.includes(item.status) && !item.carried_forward;

/**
 * "Open" means not yet done, across both sources: meeting items store `open`,
 * minutes items `pending`, and both can be `in_progress` or (minutes)
 * `overdue`. Sent to the API as a status it matched exactly, "Open" found
 * meeting items only — zero rows beside an Open tile reading 3 (W52-3). It is
 * sent as `open_only`, the rule the dashboard tile counts by.
 */
const OPEN_FILTER = 'open';

/**
 * Overdue is decided by the server, with the predicate the dashboard's overdue
 * cards count by, so a card's link opens on exactly the rows it counted. It is
 * not a stored status: sent as one it would match only minutes items a person
 * had marked `overdue` by hand, which the cards never count.
 */
const OVERDUE_FILTER = 'overdue';

const STATUS_FILTERS: readonly string[] = [
  OPEN_FILTER,
  OVERDUE_FILTER,
  'pending',
  'in_progress',
  'completed',
  'cancelled',
];

type SourceFilter = '' | 'meeting' | 'minutes';

const sourceFromParam = (value: string | null): SourceFilter =>
  value === 'meeting' || value === 'minutes' ? value : '';

const statusFromParam = (value: string | null): string => (value && STATUS_FILTERS.includes(value) ? value : '');

const priorityLabel = (item: ActionItemSummary): string | undefined =>
  item.priority && item.source === 'meeting'
    ? (MEETING_PRIORITY_LABELS[item.priority] ?? item.priority)
    : item.priority;

/** How many recent meetings the meeting filter offers. */
const MEETING_FILTER_LIMIT = 100;

const EMPTY_PAGE: ActionItemPage = { items: [], total: 0, open_total: 0, overdue_total: 0, limit: 0, offset: 0 };

const ActionItemsPage: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ActionItemPage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(() => statusFromParam(searchParams.get('status')));
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(() => sourceFromParam(searchParams.get('source')));
  const [assigneeFilter, setAssigneeFilter] = useState<string>(() => searchParams.get('assignee') ?? '');
  const [meetingFilter, setMeetingFilter] = useState<string>(() => searchParams.get('meeting') ?? '');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canManageMeetings = checkPermission('meetings.manage');
  const canManageMinutes = checkPermission('minutes.manage');
  const canViewMeetings = checkPermission('meetings.view') || checkPermission('minutes.view');
  const [assignees, setAssignees] = useState<ActionItemAssignee[]>([]);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [editing, setEditing] = useState<ActionItemSummary | null>(null);
  const [editingMeetingItem, setEditingMeetingItem] = useState<ActionItemSummary | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editErrors, setEditErrors] = useState<Partial<Record<ActionItemEditField, string | undefined>>>({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Only minutes items carry an assignee_id the server can match an assignee
  // on (W52-7); an item assigned by name only, or a meeting item, is not
  // offered.
  const isMine = (item: ActionItemSummary): boolean =>
    item.source === 'minutes' && !!currentUserId && item.assignee_id === currentUserId;

  const canUpdateMinutesItem = (item: ActionItemSummary): boolean =>
    item.source === 'minutes' && !item.carried_forward && (canManageMinutes || isMine(item));

  const canManageItem = (item: ActionItemSummary): boolean =>
    item.source === 'meeting' ? canManageMeetings : canUpdateMinutesItem(item);

  // The pickers' own reads are gated as the backend gates them, so a member
  // who cannot use them never asks.
  useEffect(() => {
    if (!canManageMeetings && !canManageMinutes) return;
    minutesService
      .getActionItemAssignees()
      .then(setAssignees)
      .catch(() => setAssignees([]));
  }, [canManageMeetings, canManageMinutes]);

  useEffect(() => {
    if (!canViewMeetings) return;
    meetingsService
      .getMeetings({ limit: MEETING_FILTER_LIMIT })
      .then((res) => setMeetings(res.meetings))
      .catch(() => setMeetings([]));
  }, [canViewMeetings]);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const result = await dashboardService.getActionItems({
        ...(statusFilter && statusFilter !== OPEN_FILTER && statusFilter !== OVERDUE_FILTER
          ? { status_filter: statusFilter }
          : {}),
        ...(statusFilter === OPEN_FILTER ? { open_only: true } : {}),
        ...(statusFilter === OVERDUE_FILTER ? { overdue: true } : {}),
        // A meeting is only ever the source of meeting items.
        ...(meetingFilter ? { source: 'meeting' as const, source_id: meetingFilter } : {}),
        ...(sourceFilter && !meetingFilter ? { source: sourceFilter } : {}),
        ...(assignedToMe ? { assigned_to_me: assignedToMe } : {}),
        ...(assigneeFilter ? { assignee_id: assigneeFilter } : {}),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setData(result);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, assignedToMe, assigneeFilter, meetingFilter, page, pageSize]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // A filter changed on the page drops the parameter that seeded it, so a
  // reload or a shared link does not bring back a filter the user cleared.
  // It also returns to the first page: page 3 of a narrower list may not exist.
  const changeFilter = (name: string, apply: () => void) => {
    apply();
    setPage(1);
    if (!searchParams.has(name)) return;
    const next = new URLSearchParams(searchParams);
    next.delete(name);
    setSearchParams(next, { replace: true });
  };

  const openEditor = (item: ActionItemSummary) => {
    setEditing(item);
    setEditStatus(item.status);
    setEditNotes(item.completion_notes ?? '');
    setEditErrors({});
  };

  const closeEditor = () => {
    setEditing(null);
    setEditErrors({});
  };
  const editDirty =
    editing !== null && (editStatus !== editing.status || editNotes !== (editing.completion_notes ?? ''));
  // One guard for Escape, the header X and Cancel, so the question is asked
  // once whichever way the member leaves (forms review F-6).
  const requestCloseEditor = useDiscardGuard({ isDirty: editDirty, onClose: closeEditor });

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      status: editStatus,
      completion_notes: blankToNull(editNotes),
    };
    try {
      let refused: Partial<Record<ActionItemEditField, string>> = {};
      try {
        await minutesService.updateActionItem(editing.source_id, editing.id, payload);
      } catch (err: unknown) {
        // Single-save rule (owner, 2026-11-05): a value the record cannot hold
        // is not written, the rest saves, and the field stays flagged with the
        // server's reason. A refusal the form has no field for is a failure.
        const mapped = mapServerFieldErrors(err, ACTION_ITEM_EDIT_FIELDS);
        const keys = mapped ? (Object.keys(mapped.fieldErrors) as ActionItemEditField[]) : [];
        if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
        refused = mapped.fieldErrors;
        const rest = { ...payload };
        for (const key of keys) delete rest[key];
        if (Object.keys(rest).length > 0) {
          await minutesService.updateActionItem(editing.source_id, editing.id, rest);
        }
      }
      await fetchItems();
      const firstRefused = (Object.keys(ACTION_ITEM_EDIT_FIELDS) as ActionItemEditField[]).find((f) => refused[f]);
      if (firstRefused) {
        setEditErrors(refused);
        toast.error(
          `Saved, except ${ACTION_ITEM_EDIT_FIELDS[firstRefused].label.toLowerCase()}. Fix it and save again.`
        );
        document.getElementById(ACTION_ITEM_EDIT_IDS[firstRefused])?.focus();
        return;
      }
      toast.success('Action item updated');
      closeEditor();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the action item'));
    } finally {
      setSaving(false);
    }
  };

  const markComplete = async (item: ActionItemSummary) => {
    setBusyId(item.id);
    try {
      if (item.source === 'meeting') {
        await meetingsService.updateActionItem(item.id, { status: 'completed' });
      } else {
        await minutesService.updateActionItem(item.source_id, item.id, { status: 'completed' });
      }
      toast.success('Marked complete');
      await fetchItems();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not mark the action item complete'));
    } finally {
      setBusyId(null);
    }
  };

  const deleteMeetingItem = async (item: ActionItemSummary) => {
    const confirmed = await confirm({
      title: 'Delete this action item?',
      message: `"${item.description}" is removed from its meeting and from this list. This cannot be undone. To close an item that is finished or no longer needed, mark it complete or cancelled instead.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    setBusyId(item.id);
    try {
      await meetingsService.deleteActionItem(item.id);
      toast.success('Action item deleted');
      // The last row of a page going leaves an empty page; step back to the
      // one before it rather than showing nothing.
      if (data.items.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await fetchItems();
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete the action item'));
    } finally {
      setBusyId(null);
    }
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

  const items = data.items;
  const filtered = !!(statusFilter || sourceFilter || assignedToMe || assigneeFilter || meetingFilter);
  const meetingOptions =
    meetingFilter && !meetings.some((m) => m.id === meetingFilter)
      ? [{ id: meetingFilter, title: 'Selected meeting', meeting_date: '' }, ...meetings]
      : meetings;

  return (
    <div className="mx-auto max-w-7xl">
      <GovernancePageHeader
        icon={AlertTriangle}
        title="Action Items"
        subtitle="Action items from meetings and minutes, soonest due first"
      />

      {/* Summary Cards — the server's totals over every matching item, not
          just this page (DASH-40), counted as the dashboard tile counts. */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Total Items</p>
          <p className="text-theme-text-primary text-2xl font-bold" data-testid="action-items-total">
            {data.total}
          </p>
        </div>
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Open</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400" data-testid="action-items-open">
            {data.open_total}
          </p>
        </div>
        <div className="card-secondary p-4">
          <p className="text-theme-text-muted text-sm">Overdue</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-400" data-testid="action-items-overdue">
            {data.overdue_total}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Filter className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
        <select
          value={statusFilter}
          onChange={(e) => changeFilter('status', () => setStatusFilter(e.target.value))}
          aria-label="Filter action items by status"
          className="form-input-sm w-auto"
        >
          <option value="">All Statuses</option>
          <option value={OPEN_FILTER}>Open (not done)</option>
          <option value={OVERDUE_FILTER}>Overdue</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={meetingFilter ? 'meeting' : sourceFilter}
          onChange={(e) => changeFilter('source', () => setSourceFilter(sourceFromParam(e.target.value)))}
          disabled={!!meetingFilter}
          aria-label="Filter action items by source"
          className="form-input-sm w-auto"
        >
          <option value="">All Sources</option>
          <option value="meeting">Meetings</option>
          <option value="minutes">Minutes</option>
        </select>
        {meetingOptions.length > 0 && (
          <select
            value={meetingFilter}
            onChange={(e) => changeFilter('meeting', () => setMeetingFilter(e.target.value))}
            aria-label="Filter action items by meeting"
            className="form-input-sm w-auto max-w-xs"
          >
            <option value="">All Meetings</option>
            {meetingOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.meeting_date ? `${m.title} (${formatCalendarDate(m.meeting_date)})` : m.title}
              </option>
            ))}
          </select>
        )}
        {assignees.length > 0 && (
          <select
            value={assigneeFilter}
            onChange={(e) => changeFilter('assignee', () => setAssigneeFilter(e.target.value))}
            aria-label="Filter action items by assignee"
            className="form-input-sm w-auto max-w-xs"
          >
            <option value="">Anyone</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <label className="text-theme-text-secondary touch:min-h-[44px] flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={(e) => changeFilter('mine', () => setAssignedToMe(e.target.checked))}
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
          title={filtered ? 'No matching action items' : 'No action items'}
          description={
            filtered
              ? 'Choose a different filter or clear "Assigned to me" to see more.'
              : 'Action items recorded in meetings and minutes appear here.'
          }
        />
      ) : (
        <>
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
                        {item.carried_forward && (
                          <span className="bg-theme-surface-secondary text-theme-text-primary inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium">
                            Carried forward
                          </span>
                        )}
                        {item.priority && (
                          <span
                            className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGES[priorityLabel(item) ?? ''] || ''}`}
                          >
                            {priorityLabel(item)}
                          </span>
                        )}
                        <span className="text-theme-text-muted text-xs">
                          {item.source === 'meeting' ? (item.source_title ?? 'Meeting') : 'Minutes'}
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
                {canManageItem(item) && (
                  <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
                    {isOpen(item) && (
                      <button
                        type="button"
                        onClick={() => void markComplete(item)}
                        disabled={busyId === item.id}
                        aria-label={`Mark ${item.description} complete`}
                        className="btn-secondary touch:min-h-11 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                      >
                        Mark complete
                      </button>
                    )}
                    {item.source === 'meeting' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingMeetingItem(item)}
                          aria-label={`Edit ${item.description}`}
                          className="btn-secondary touch:min-h-11 rounded-lg px-3 py-2 text-sm"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteMeetingItem(item)}
                          disabled={busyId === item.id}
                          aria-label={`Delete ${item.description}`}
                          className="btn-secondary touch:min-h-11 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openEditor(item)}
                        aria-label={`Update status of ${item.description}`}
                        className="btn-secondary touch:min-h-11 rounded-lg px-3 py-2 text-sm"
                      >
                        Update status
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Pagination
            currentPage={page}
            totalItems={data.total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            className="mt-4"
          />
        </>
      )}

      <MeetingActionItemDialog
        item={editingMeetingItem}
        assignees={assignees}
        onClose={() => setEditingMeetingItem(null)}
        onSaved={() => {
          setEditingMeetingItem(null);
          void fetchItems();
        }}
      />

      <Modal
        isOpen={editing !== null}
        onClose={requestCloseEditor}
        title="Update action item"
        size="sm"
        onSubmit={(e) => {
          e.preventDefault();
          void saveEdit();
        }}
        footer={
          <div className="flex justify-end gap-3">
            <button type="button" onClick={requestCloseEditor} className="btn-secondary rounded-lg px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              type="submit"
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
              {canManageMinutes ? (
                <>
                  Change the status and completion notes here. The description, assignee and due date are edited on{' '}
                  <Link to={`/minutes/${editing.source_id}`} className="underline">
                    its minutes
                  </Link>
                  .
                </>
              ) : (
                'As the assignee you can change the status and add completion notes. Anything else is changed by whoever keeps the minutes.'
              )}
            </p>
            <FormField label="Status" id="assignee-status" error={editErrors.status}>
              {(field) => (
                <select
                  {...field}
                  value={editStatus}
                  onChange={(e) => {
                    setEditStatus(e.target.value);
                    setEditErrors((prev) => ({ ...prev, status: undefined }));
                  }}
                  className="form-input"
                >
                  {MINUTES_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Completion notes" id="assignee-notes" error={editErrors.completion_notes}>
              {(field) => (
                <textarea
                  {...field}
                  rows={3}
                  value={editNotes}
                  onChange={(e) => {
                    setEditNotes(e.target.value);
                    setEditErrors((prev) => ({ ...prev, completion_notes: undefined }));
                  }}
                  className="form-input"
                />
              )}
            </FormField>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ActionItemsPage;
