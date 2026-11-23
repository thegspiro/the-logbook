/**
 * Attendance waiver requests — the approver's queue.
 *
 * Lists what the workflow's `GET .../requests` returns for the caller: the
 * requests they may decide or have decided. Who that is depends on the
 * positions the department routes requests to, the Chief and President and the
 * workflow's fallback, so the page asks the server rather than gating on a
 * permission; a member who decides nothing sees an empty queue.
 *
 * One page serves both workflows (`workflow`): training sessions at
 * `/attendance-waivers`, business meetings at `/meetings/waiver-requests`.
 *
 * Pending requests come first and decided ones follow, each list a page at a
 * time; the server splits them (`state`), so each pages on its own count. Each row opens the decision page the approver's email links to.
 *
 * Also rendered inside the Training Admin hub (`embedded`), without its own
 * page header.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarX, ChevronRight } from 'lucide-react';
import { EmptyState } from '../../components/ux';
import { SkeletonCard } from '../../components/ux/Skeleton';
import {
  ATTENDANCE_WAIVER_STATUS_COLORS,
  ATTENDANCE_WAIVER_STATUS_LABELS,
  AttendanceWaiverStatus,
} from '../../constants/enums';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';
import { useTimezone } from '../../hooks/useTimezone';
import { formatCalendarDate, formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { awaitsReconfirmation, closesUndecidedText } from '../../utils/attendanceWaivers';
import { TRAINING_WAIVER_WORKFLOW, type AttendanceWaiverWorkflow } from '../../utils/attendanceWaiverWorkflows';
import { useWaiverAttentionStore } from '../../hooks/useWaiverAttention';

const QUEUE_PAGE = 50;

/** One of the queue's two lists, loaded a page at a time. */
interface QueueList {
  items: AttendanceWaiverRequest[];
  total: number;
}

const EMPTY_LIST: QueueList = { items: [], total: 0 };

const RequestRow: React.FC<{ request: AttendanceWaiverRequest; timezone: string; path: string }> = ({
  request,
  timezone,
  path,
}) => (
  <li>
    <Link to={path} className="hover:bg-theme-surface-hover flex items-center gap-3 rounded-lg p-4 transition-colors">
      <span className="min-w-0 flex-1">
        <span className="text-theme-text-primary block font-medium">{request.member_name ?? 'A member'}</span>
        <span className="text-theme-text-secondary block text-sm">
          {request.event_title} ·{' '}
          {formatCalendarDate(request.session_date, { month: 'short', day: 'numeric', year: 'numeric' })}
          {request.category ? ` · ${request.category}` : ''}
        </span>
        <span className="text-theme-text-muted block text-xs">
          Asked {formatDateTime(request.submitted_at, timezone)}
          {request.decided_by_name ? ` · decided by ${request.decided_by_name}` : ''}
        </span>
        {closesUndecidedText(request, timezone) && (
          <span className="text-theme-text-muted block text-xs">{closesUndecidedText(request, timezone)}</span>
        )}
      </span>
      {/* The server's flag, cleared when the member answers or the request is decided. */}
      {request.info_requested_at && request.status === AttendanceWaiverStatus.PENDING && (
        <span className="badge border border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-300">
          Waiting on member
        </span>
      )}
      {awaitsReconfirmation(request) && (
        <span className="badge border border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-300">
          Session moved: member to confirm
        </span>
      )}
      <span className={`badge border ${ATTENDANCE_WAIVER_STATUS_COLORS[request.status] ?? ''}`}>
        {ATTENDANCE_WAIVER_STATUS_LABELS[request.status] ?? request.status}
      </span>
      <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
    </Link>
  </li>
);

interface AttendanceWaiverQueuePageProps {
  embedded?: boolean;
  /** Training sessions when omitted. */
  workflow?: AttendanceWaiverWorkflow;
}

export const AttendanceWaiverQueuePage: React.FC<AttendanceWaiverQueuePageProps> = ({
  embedded = false,
  workflow = TRAINING_WAIVER_WORKFLOW,
}) => {
  const tz = useTimezone();
  const { service } = workflow;
  const refreshAttention = useWaiverAttentionStore((s) => s.refresh);
  const [pending, setPending] = useState<QueueList>(EMPTY_LIST);
  // Decided also holds the requests that closed without a decision
  // (withdrawn, voided, expired), each labelled by its status badge.
  const [decided, setDecided] = useState<QueueList>(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<'pending' | 'decided' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (state: 'pending' | 'decided', skip: number): Promise<QueueList> => {
      const page = await service.list({ state, skip, limit: QUEUE_PAGE });
      return { items: page.items, total: page.total };
    },
    [service]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [waiting, closed] = await Promise.all([fetchPage('pending', 0), fetchPage('decided', 0)]);
        if (cancelled) return;
        setPending(waiting);
        setDecided(closed);
        // The navigation's waiting count follows what this queue shows.
        void refreshAttention(workflow.key);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Waiver requests could not be loaded.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, refreshAttention, workflow.key]);

  const showMore = async (state: 'pending' | 'decided') => {
    const current = state === 'pending' ? pending : decided;
    const set = state === 'pending' ? setPending : setDecided;
    setLoadingMore(state);
    try {
      const next = await fetchPage(state, current.items.length);
      set({ items: [...current.items, ...next.items], total: next.total });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'More requests could not be loaded.'));
    } finally {
      setLoadingMore(null);
    }
  };

  const showMoreButton = (state: 'pending' | 'decided', list: QueueList, label: string) =>
    list.items.length < list.total && (
      <button
        type="button"
        onClick={() => void showMore(state)}
        disabled={loadingMore !== null}
        className="btn-secondary mt-2 text-sm font-medium disabled:opacity-50"
      >
        {loadingMore === state ? 'Loading...' : label}
      </button>
    );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="space-y-4" role="status" aria-live="polite">
        <span className="sr-only">Loading waiver requests…</span>
        <SkeletonCard />
      </div>
    );
  } else if (error) {
    body = (
      <div className="alert-danger rounded-lg p-4 text-sm" role="alert">
        {error}
      </div>
    );
  } else if (pending.items.length === 0 && decided.items.length === 0) {
    body = (
      <EmptyState
        icon={CalendarX}
        title="No waiver requests for you"
        description={`When a member asks to be excused from a ${workflow.sessionNoun} and you are one of the people who decide, the request appears here.`}
      />
    );
  } else {
    body = (
      <div className="space-y-6">
        <section aria-labelledby="waiver-queue-pending">
          <h2 id="waiver-queue-pending" className="text-theme-text-primary mb-2 text-lg font-semibold">
            Waiting for a decision ({pending.total})
          </h2>
          {pending.items.length === 0 ? (
            <p className="text-theme-text-secondary text-sm">Nothing is waiting for you.</p>
          ) : (
            <ul className="card divide-theme-surface-border divide-y">
              {pending.items.map((request) => (
                <RequestRow key={request.id} request={request} timezone={tz} path={workflow.requestPath(request.id)} />
              ))}
            </ul>
          )}
          {showMoreButton('pending', pending, 'Show more waiting requests')}
        </section>

        {decided.items.length > 0 && (
          <section aria-labelledby="waiver-queue-decided">
            <h2 id="waiver-queue-decided" className="text-theme-text-primary mb-2 text-lg font-semibold">
              Decided and closed
            </h2>
            <ul className="card divide-theme-surface-border divide-y">
              {decided.items.map((request) => (
                <RequestRow key={request.id} request={request} timezone={tz} path={workflow.requestPath(request.id)} />
              ))}
            </ul>
            {showMoreButton('decided', decided, 'Show more decided requests')}
          </section>
        )}
      </div>
    );
  }

  if (embedded) return <div className="py-6">{body}</div>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <workflow.PageHeader
        icon={CalendarX}
        title="Attendance waiver requests"
        subtitle={`Members asking to be excused from a ${workflow.sessionNoun}`}
      />
      <div className="mt-6">{body}</div>
    </div>
  );
};

export default AttendanceWaiverQueuePage;
