/**
 * Training Approval
 *
 * Where a training officer confirms the credit a Training event's attendance
 * earned, when that event's training session requires officer confirmation.
 * Reached from the link in the officer's email and from the event page, both
 * of which carry the approval token (`/training/approve/:token`).
 *
 * Unlike the finance approval link, the token is NOT the authorization: the
 * roster carries member names and emails, so the backend requires a signed-in
 * `training.manage` holder in the approval's organization, and the route is
 * gated the same way.
 *
 * The roster is the backend's snapshot from Finalize Attendance — its times and
 * minutes are the credited ones — so this page shows them as sent rather than
 * re-deriving a duration from the check-in and check-out (CLAUDE.md #29).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { trainingSessionService } from '../../services/api';
import type { TrainingApprovalAttendee, TrainingApprovalData } from '../../services/api';
import { Breadcrumbs } from '../../components/ux/Breadcrumbs';
import { SkeletonCard, SkeletonRow } from '../../components/ux/Skeleton';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import {
  formatDate,
  formatDateTime,
  formatShortDateTime,
  formatTime,
  toLocalISODate,
} from '../../utils/dateFormatting';
import { getErrorDetail, getErrorMessage, toAppError } from '../../utils/errorHandling';

const TRAINING_DASHBOARD = '/training/admin';

const TRAIL = [{ label: 'Training Administration', path: TRAINING_DASHBOARD }, { label: 'Approve training credit' }];

/** Mirrors the backend's `ApprovalStatus`; an unknown value is shown as sent. */
const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  modified: 'Approved with changes',
  rejected: 'Rejected',
};

const STATUS_BADGES: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  approved: 'bg-green-500/20 text-green-800 dark:text-green-300',
  modified: 'bg-green-500/20 text-green-800 dark:text-green-300',
  rejected: 'bg-red-500/20 text-red-800 dark:text-red-300',
};

/** What the read-only notice leads with once the approval is no longer pending. */
const PROCESSED_HEADINGS: Record<string, string> = {
  approved: 'Already approved',
  modified: 'Already approved',
  rejected: 'Already rejected',
};

type LoadError =
  { kind: 'forbidden' } | { kind: 'link'; message: string; expired: boolean } | { kind: 'failed'; message: string };

interface RowDraft {
  minutes: string;
  note: string;
}

/**
 * The figure the minutes input starts from: an Edit Times override the member
 * already carries, else the minutes the backend credited. `??` rather than
 * `||` because 0 is a real value here — a member credited no time.
 */
const prefillMinutes = (attendee: TrainingApprovalAttendee): string => {
  const minutes = attendee.override_duration_minutes ?? attendee.calculated_duration_minutes;
  return minutes === null || minutes === undefined ? '' : String(minutes);
};

/**
 * Inline validation for one row. An untouched row is always valid — it sends
 * its snapshot back unchanged, even when the snapshot has no minutes at all.
 */
const minutesError = (value: string, prefill: string): string | null => {
  if (value === prefill) return null;
  const trimmed = value.trim();
  if (trimmed === '') return 'Enter the approved minutes. 0 gives no credit.';
  if (!/^\d+$/.test(trimmed)) return 'Enter whole minutes, 0 or more.';
  return null;
};

const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

const toLoadError = (err: unknown): LoadError => {
  const status = toAppError(err).status;
  if (status === 403) return { kind: 'forbidden' };
  if (status === 400) {
    const message = getErrorDetail(err) || 'Invalid approval link';
    return { kind: 'link', message, expired: /expired/i.test(message) };
  }
  return { kind: 'failed', message: getErrorMessage(err, 'Could not load this approval.') };
};

const memberCount = (n: number): string => `${n} ${n === 1 ? 'member' : 'members'}`;

export const TrainingApprovalPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();
  const { confirm } = useConfirm();

  const [data, setData] = useState<TrainingApprovalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [approvalNotes, setApprovalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!token) {
        setLoadError({ kind: 'link', message: 'Invalid approval link', expired: false });
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      // Notes typed against one approval must not be filed against the next.
      setApprovalNotes('');
      setSubmitError(null);
      try {
        const approval = await trainingSessionService.getApprovalData(token);
        if (!active) return;
        setData(approval);
        setDrafts(
          Object.fromEntries(
            approval.attendees.map((a) => [a.user_id, { minutes: prefillMinutes(a), note: a.notes ?? '' }])
          )
        );
      } catch (err: unknown) {
        if (!active) return;
        setLoadError(toLoadError(err));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [token]);

  const errors = useMemo(() => {
    const found: Record<string, string> = {};
    for (const attendee of data?.attendees ?? []) {
      const draft = drafts[attendee.user_id];
      if (!draft) continue;
      const message = minutesError(draft.minutes, prefillMinutes(attendee));
      if (message) found[attendee.user_id] = message;
    }
    return found;
  }, [data, drafts]);
  const hasErrors = Object.keys(errors).length > 0;

  const updateDraft = (userId: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [userId]: { minutes: prev[userId]?.minutes ?? '', note: prev[userId]?.note ?? '', ...patch },
    }));
  };

  /**
   * A refused submit (400) means the approval moved on while this page was
   * open: a reopen expired its link, or another officer processed it. Re-read
   * it so the page shows that state — and, for an expired link, how to get a
   * new one — rather than leaving a button that can only be refused again.
   * If it is somehow still pending the page is left as is, edits included.
   */
  const showCurrentState = async (approvalToken: string) => {
    try {
      const current = await trainingSessionService.getApprovalData(approvalToken);
      if (current.status !== 'pending') setData(current);
    } catch (err: unknown) {
      setLoadError(toLoadError(err));
    }
  };

  const handleApprove = async () => {
    if (!data || !token || hasErrors) return;
    const count = data.attendees.length;
    const confirmed = await confirm({
      title: 'Record training credit?',
      message: `Records ${count} ${count === 1 ? "member's" : "members'"} training credit. Approved minutes of 0 give that member no credit.`,
      confirmLabel: 'Approve and record',
      cancelLabel: 'Keep reviewing',
      variant: 'info',
    });
    if (!confirmed) return;

    const attendees = data.attendees.map((a): TrainingApprovalAttendee => {
      const draft = drafts[a.user_id];
      const value = draft?.minutes ?? prefillMinutes(a);
      const edited = value !== prefillMinutes(a);
      return {
        ...a,
        approved: true,
        notes: draft?.note.trim() || null,
        // An untouched row returns its snapshot override — null means "use the
        // member's credited minutes" — so approving without edits changes
        // nothing about how long anyone is credited for.
        override_duration_minutes: edited ? Number(value.trim()) : (a.override_duration_minutes ?? null),
      };
    });

    setSubmitting(true);
    setSubmitError(null);
    try {
      await trainingSessionService.submitApproval(token, {
        attendees,
        approval_notes: approvalNotes.trim() || undefined,
      });
      // An approved 0 voids that member's credit, so "recorded for N members"
      // would overstate it whenever a row went through at 0. The figure is the
      // one the row showed: the officer's, else the snapshot's.
      const uncredited = attendees.filter(
        (a) => (a.override_duration_minutes ?? a.calculated_duration_minutes) === 0
      ).length;
      toast.success(
        uncredited === 0
          ? `Training credit recorded for ${memberCount(count)}`
          : `Approval recorded: ${memberCount(count - uncredited)} credited, ${uncredited} given no credit`
      );
      void navigate(`/events/${data.event_id}`);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Could not record the approval.');
      setSubmitError(message);
      toast.error(message);
      if (toAppError(err).status === 400) await showCurrentState(token);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs items={TRAIL} />
        <div className="space-y-6" role="status" aria-live="polite">
          <span className="sr-only">Loading approval…</span>
          <SkeletonCard />
          <div className="card overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border-theme-surface-border border-b last:border-b-0">
                <SkeletonRow columns={5} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    const error: LoadError = loadError ?? { kind: 'failed', message: 'Could not load this approval.' };
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs items={TRAIL} />
        <div className="card p-6" role="alert">
          <div className="flex items-start gap-3">
            {error.kind === 'forbidden' ? (
              <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
            ) : (
              <AlertTriangle
                className="mt-0.5 h-6 w-6 shrink-0 text-amber-700 dark:text-amber-400"
                aria-hidden="true"
              />
            )}
            <div className="space-y-2">
              <h1 className="text-theme-text-primary text-xl font-semibold">Training approval</h1>
              {error.kind === 'forbidden' ? (
                <p className="text-theme-text-primary">
                  You are not authorized to approve training credit. Approving needs the Training management permission
                  in this department.
                </p>
              ) : (
                <p className="text-theme-text-primary">{error.message}</p>
              )}
              {/* A re-finalize expires the old link and emails a new one, so an
                  officer holding the old email may already have a live link
                  and must not be sent to reopen attendance for nothing. */}
              {error.kind === 'link' && error.expired && (
                <div className="text-theme-text-secondary space-y-1 text-sm">
                  <p>
                    If the event&apos;s attendance has been finalized again since this link was sent, use the newer link
                    in that email or on the event page.
                  </p>
                  <p>Reopening the event&apos;s attendance and finalizing it again issues a new link.</p>
                </div>
              )}
              <Link
                to={TRAINING_DASHBOARD}
                className="inline-block text-sm font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-400"
              >
                Back to the training dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pending = data.status === 'pending';
  const eventDay = toLocalISODate(data.event_start_datetime, tz);
  // A check-in on the event's own day reads as a clock time; one on another
  // day (an overnight drill) needs its date to be unambiguous.
  const formatCredited = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    return toLocalISODate(iso, tz) === eventDay ? formatTime(iso, tz) : formatShortDateTime(iso, tz);
  };
  const count = data.attendees.length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumbs items={TRAIL} />

      <header className="card mb-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-theme-text-muted text-sm font-medium">Approve training credit</p>
            <h1 className="text-theme-text-primary text-2xl font-bold break-words">
              <Link to={`/events/${data.event_id}`} className="underline-offset-2 hover:underline">
                {data.event_title}
              </Link>
            </h1>
          </div>
          <span
            className={`badge ${STATUS_BADGES[data.status] ?? 'bg-theme-surface-secondary text-theme-text-primary'}`}
          >
            {statusLabel(data.status)}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-theme-text-muted">Course</dt>
            <dd className="text-theme-text-primary font-medium">{data.course_name || data.event_title}</dd>
          </div>
          <div>
            <dt className="text-theme-text-muted">Event date</dt>
            <dd className="text-theme-text-primary font-medium">{formatDate(data.event_start_datetime, tz)}</dd>
          </div>
          <div>
            <dt className="text-theme-text-muted">Approve by</dt>
            <dd className="text-theme-text-primary font-medium">{formatDateTime(data.approval_deadline, tz)}</dd>
          </div>
        </dl>
      </header>

      {pending ? (
        <p className="text-theme-text-secondary mb-4 text-sm">
          Until you approve, these members&apos; training records show In Progress. Approving records each member&apos;s
          credit as completed for the approved minutes. Approved minutes start at the credited time; change a figure to
          credit a different amount, or enter 0 to give that member no credit.
        </p>
      ) : (
        <div className="alert-info mb-4 flex items-start gap-3" role="status">
          <CheckCircle2 className="text-theme-alert-info-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-theme-alert-info-title font-semibold">
              {PROCESSED_HEADINGS[data.status] ?? statusLabel(data.status)}
            </p>
            <p className="text-theme-alert-info-text text-sm">
              {data.approved_at
                ? `Processed ${formatDateTime(data.approved_at, tz)}. This roster can no longer be changed here.`
                : 'This roster can no longer be changed here.'}
            </p>
          </div>
        </div>
      )}

      <section className="card mb-6 overflow-hidden" aria-labelledby="approval-roster-heading">
        <h2 id="approval-roster-heading" className="text-theme-text-primary px-4 pt-4 pb-2 text-lg font-semibold">
          Roster ({count})
        </h2>
        {count === 0 ? (
          <p className="text-theme-text-secondary px-4 pb-4 text-sm">No members are on this approval&apos;s roster.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="rwd-table w-full text-sm">
              <thead>
                <tr className="border-theme-surface-border text-theme-text-muted border-b text-left">
                  <th scope="col" className="px-4 py-3 font-medium">
                    Member
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Check-in
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Check-out
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Credited minutes
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Approved minutes
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.attendees.map((a) => {
                  const draft = drafts[a.user_id] ?? { minutes: prefillMinutes(a), note: a.notes ?? '' };
                  const error = errors[a.user_id];
                  const errorId = `approved-minutes-error-${a.user_id}`;
                  const checkIn = formatCredited(a.checked_in_at);
                  const checkOut = formatCredited(a.checked_out_at);
                  return (
                    <tr key={a.user_id} className="border-theme-surface-border border-b align-top last:border-b-0">
                      <td className="rwd-table-lead px-4 py-3" data-label="Member">
                        <span className="text-theme-text-primary font-medium">{a.user_name}</span>
                      </td>
                      <td className="text-theme-text-primary px-4 py-3" data-label="Check-in">
                        {checkIn ?? <span className="text-theme-text-muted">Not recorded</span>}
                      </td>
                      <td className="text-theme-text-primary px-4 py-3" data-label="Check-out">
                        {checkOut ?? <span className="text-theme-text-muted">Not recorded</span>}
                      </td>
                      <td className="text-theme-text-primary px-4 py-3" data-label="Credited minutes">
                        {a.calculated_duration_minutes ?? <span className="text-theme-text-muted">None</span>}
                      </td>
                      <td className="px-4 py-3" data-label="Approved minutes">
                        {pending ? (
                          <div className="flex flex-col items-end gap-1 md:items-start">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              step={1}
                              className="form-input w-28"
                              aria-label={`Approved minutes for ${a.user_name}`}
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? errorId : undefined}
                              value={draft.minutes}
                              onChange={(e) => updateDraft(a.user_id, { minutes: e.target.value })}
                            />
                            {error && (
                              <p id={errorId} className="text-xs text-red-700 dark:text-red-400">
                                {error}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-theme-text-primary">
                            {a.override_duration_minutes ?? a.calculated_duration_minutes ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" data-label="Note">
                        {pending ? (
                          <input
                            type="text"
                            className="form-input"
                            maxLength={500}
                            placeholder="Optional"
                            aria-label={`Note for ${a.user_name}`}
                            value={draft.note}
                            onChange={(e) => updateDraft(a.user_id, { note: e.target.value })}
                          />
                        ) : (
                          <span className="text-theme-text-primary">{a.notes || '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pending ? (
        <section className="card p-5" aria-label="Approve">
          <label htmlFor="approval-notes" className="form-label">
            Approval notes (optional)
          </label>
          <textarea
            id="approval-notes"
            className="form-input mb-4"
            rows={3}
            maxLength={2000}
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
            placeholder="Anything the training record should say about this approval"
          />
          {hasErrors && (
            <p className="mb-3 text-sm text-red-700 dark:text-red-400">
              Correct the approved minutes above before recording.
            </p>
          )}
          {submitError && (
            <p className="mb-3 text-sm text-red-700 dark:text-red-400" role="alert">
              {submitError}
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={submitting || hasErrors}
            onClick={() => void handleApprove()}
          >
            {submitting ? 'Recording…' : 'Approve and record'}
          </button>
        </section>
      ) : (
        data.approval_notes && (
          <section className="card p-5" aria-labelledby="approval-notes-heading">
            <h2 id="approval-notes-heading" className="text-theme-text-primary mb-1 text-base font-semibold">
              Approval notes
            </h2>
            <p className="text-theme-text-secondary text-sm whitespace-pre-line">{data.approval_notes}</p>
          </section>
        )
      )}
    </div>
  );
};

export default TrainingApprovalPage;
