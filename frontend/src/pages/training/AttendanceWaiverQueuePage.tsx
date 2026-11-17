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
 * Pending requests come first, every one of them; decided ones follow, a page
 * at a time. Each row opens the decision page the approver's email links to.
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

/** The backend's largest page (`MAX_PAGE`): every pending request in one call. */
const PENDING_LIMIT = 200;
const DECIDED_PAGE = 50;

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
  const [pending, setPending] = useState<AttendanceWaiverRequest[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [decided, setDecided] = useState<AttendanceWaiverRequest[]>([]);
  const [nextSkip, setNextSkip] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The decided list is the unfiltered list with the pending rows left out:
  // the API filters by one status at a time, and decided means several. It
  // also holds the requests that closed without a decision (withdrawn,
  // voided, expired), each labelled by its status badge.
  const loadDecided = useCallback(
    async (skip: number) => {
      const page = await service.list({ skip, limit: DECIDED_PAGE });
      const rows = page.items.filter((r) => r.status !== AttendanceWaiverStatus.PENDING);
      setDecided((current) => (skip === 0 ? rows : [...current, ...rows]));
      setNextSkip(skip + page.items.length);
      setHasMore(skip + page.items.length < page.total);
    },
    [service]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const page = await service.list({
          status: AttendanceWaiverStatus.PENDING,
          limit: PENDING_LIMIT,
        });
        if (cancelled) return;
        setPending(page.items);
        setPendingTotal(page.total);
        // The navigation's waiting count follows what this queue shows.
        void refreshAttention(workflow.key);
        await loadDecided(0);
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
  }, [loadDecided, service, refreshAttention, workflow.key]);

  const showMore = async () => {
    setLoadingMore(true);
    try {
      await loadDecided(nextSkip);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'More requests could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  };

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
  } else if (pending.length === 0 && decided.length === 0) {
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
            Waiting for a decision ({pendingTotal})
          </h2>
          {pending.length === 0 ? (
            <p className="text-theme-text-secondary text-sm">Nothing is waiting for you.</p>
          ) : (
            <ul className="card divide-theme-surface-border divide-y">
              {pending.map((request) => (
                <RequestRow key={request.id} request={request} timezone={tz} path={workflow.requestPath(request.id)} />
              ))}
            </ul>
          )}
          {pendingTotal > pending.length && (
            <p className="text-theme-text-muted mt-2 text-sm">
              Showing the newest {pending.length} of {pendingTotal}. Decide these to see the rest.
            </p>
          )}
        </section>

        {decided.length > 0 && (
          <section aria-labelledby="waiver-queue-decided">
            <h2 id="waiver-queue-decided" className="text-theme-text-primary mb-2 text-lg font-semibold">
              Decided and closed
            </h2>
            <ul className="card divide-theme-surface-border divide-y">
              {decided.map((request) => (
                <RequestRow key={request.id} request={request} timezone={tz} path={workflow.requestPath(request.id)} />
              ))}
            </ul>
          </section>
        )}
        {hasMore && (
          <button
            type="button"
            onClick={() => void showMore()}
            disabled={loadingMore}
            className="btn-secondary text-sm font-medium disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Show more'}
          </button>
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
