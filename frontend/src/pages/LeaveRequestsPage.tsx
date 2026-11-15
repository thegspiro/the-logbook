/**
 * Leave Requests — a member asks for a leave of absence, and the department's
 * approvers decide it.
 *
 * Open to every signed-in member: asking needs no permission, and who may
 * decide is the department's chosen positions (falling back to the Chief, then
 * to everyone who can record leave), worked out by the server. So the page
 * shows "To decide" only when the server returns something to decide, and
 * never decides who is an approver itself (CLAUDE.md pitfall #29).
 *
 * The member's reason is shown to them and to their approvers only, and is
 * never emailed.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { leaveRequestService } from '../services/leaveRequestService';
import { useConfirm } from '../contexts/ConfirmContext';
import { useTimezone } from '../hooks/useTimezone';
import { useAuthStore } from '../stores/authStore';
import { formatCalendarDate, formatDate, getTodayLocalDate } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { LeaveDecisionRule, LeaveRequestStatus, type LeaveRequest, type LeaveVote } from '../types/leaveRequest';

// The kinds a member asks for. Administrative and new-member leave are an
// officer's to record, not a member's to request.
const REQUEST_TYPES = [
  { value: 'leave_of_absence', label: 'Leave of Absence' },
  { value: 'medical', label: 'Medical' },
  { value: 'military', label: 'Military' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
];

const typeLabel = (value: string): string =>
  REQUEST_TYPES.find((t) => t.value === value)?.label ?? value.replace(/_/g, ' ');

const STATUS_STYLES: Record<string, string> = {
  [LeaveRequestStatus.PENDING]: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  [LeaveRequestStatus.APPROVED]: 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200',
  [LeaveRequestStatus.DENIED]: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200',
  [LeaveRequestStatus.WITHDRAWN]: 'bg-theme-surface-hover text-theme-text-secondary',
};

const STATUS_LABELS: Record<string, string> = {
  [LeaveRequestStatus.PENDING]: 'Waiting',
  [LeaveRequestStatus.APPROVED]: 'Approved',
  [LeaveRequestStatus.DENIED]: 'Denied',
  [LeaveRequestStatus.WITHDRAWN]: 'Withdrawn',
};

const dates = (r: LeaveRequest): string =>
  `${formatCalendarDate(r.start_date)} – ${r.end_date ? formatCalendarDate(r.end_date) : 'no end date'}`;

/** Where the request stands under the department's rule, in one line. */
const tallyLine = (r: LeaveRequest): string => {
  if (r.status !== LeaveRequestStatus.PENDING) return '';
  if (r.approver_count === 0) return 'Nobody can decide this yet.';
  if (r.decision_rule === LeaveDecisionRule.ANY) return 'The first approver to answer decides.';
  return `${r.approvals} of ${r.approvals_needed} approvals needed (${r.approver_count} approvers${
    r.denials ? `, ${r.denials} denied` : ''
  }).`;
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`badge ${STATUS_STYLES[status] ?? ''}`}>{STATUS_LABELS[status] ?? status}</span>
);

const Votes: React.FC<{ request: LeaveRequest }> = ({ request }) =>
  request.votes.length === 0 ? null : (
    <ul className="mt-2 space-y-1 text-xs">
      {request.votes.map((v) => (
        <li key={v.voter_id} className="text-theme-text-secondary">
          <span className="font-medium">{v.voter_name}</span> {v.vote === 'approve' ? 'approved' : 'denied'}
          {v.note ? <>: &ldquo;{v.note}&rdquo;</> : null}
        </li>
      ))}
    </ul>
  );

const LeaveRequestsPage: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const managesLeave = checkPermission('members.manage');

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [toDecide, setToDecide] = useState<LeaveRequest[]>([]);
  const [showDecided, setShowDecided] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [form, setForm] = useState({ leave_type: 'leave_of_absence', start_date: '', end_date: '', reason: '' });
  const [openEnded, setOpenEnded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [config, own, decide] = await Promise.all([
        leaveRequestService.getConfig(),
        leaveRequestService.listMine(),
        leaveRequestService.listToDecide(showDecided),
      ]);
      setEnabled(config.requests_enabled);
      setMine(own);
      setToDecide(decide);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Leave requests did not load. Refresh to try again.'));
    }
  }, [showDecided]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.start_date) return;
    setSubmitting(true);
    try {
      await leaveRequestService.create({
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: openEnded ? undefined : form.end_date || undefined,
        reason: form.reason.trim() || undefined,
      });
      toast.success('Your request was sent to the approvers.');
      setForm({ leave_type: 'leave_of_absence', start_date: '', end_date: '', reason: '' });
      setOpenEnded(false);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Your request was not sent.'));
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (r: LeaveRequest) => {
    const ok = await confirm({
      title: 'Withdraw this request?',
      message: `Your request for ${dates(r)} will be withdrawn. You can ask again later.`,
      confirmLabel: 'Withdraw it',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    setBusy(r.id);
    try {
      await leaveRequestService.withdraw(r.id);
      toast.success('Request withdrawn.');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The request was not withdrawn.'));
    } finally {
      setBusy(null);
    }
  };

  const vote = async (r: LeaveRequest, choice: LeaveVote) => {
    if (choice === 'deny') {
      const ok = await confirm({
        title: 'Deny this request?',
        message: `${r.member_name}'s request for ${dates(r)} will be recorded as denied by you.`,
        confirmLabel: 'Deny',
        cancelLabel: 'Go back',
      });
      if (!ok) return;
    }
    setBusy(r.id);
    try {
      const result = await leaveRequestService.vote(r.id, choice, notes[r.id]);
      if (result.status === LeaveRequestStatus.APPROVED) toast.success('Approved. The leave is now recorded.');
      else if (result.status === LeaveRequestStatus.DENIED) toast.success('Denied. The member has been told.');
      else toast.success('Your vote is recorded.');
      setNotes((n) => ({ ...n, [r.id]: '' }));
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Your vote was not recorded.'));
    } finally {
      setBusy(null);
    }
  };

  const today = getTodayLocalDate(tz);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-theme-text-primary mb-1 flex items-center gap-2 text-xl font-semibold">
        <CalendarOff className="h-6 w-6" aria-hidden="true" />
        Leave Requests
      </h1>
      <p className="text-theme-text-muted mb-6 text-sm">
        Ask for a leave of absence, and see where your requests stand.
      </p>

      {loadError && (
        <div className="alert-warning text-theme-alert-warning-text mb-4 text-sm" role="alert">
          {loadError}
        </div>
      )}

      {(toDecide.length > 0 || managesLeave) && (
        <section className="card mb-6 p-4" aria-labelledby="to-decide-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="to-decide-heading" className="text-theme-text-primary font-semibold">
              To decide
            </h2>
            {managesLeave && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={showDecided}
                  onChange={(e) => setShowDecided(e.target.checked)}
                />
                Show decided requests
              </label>
            )}
          </div>
          {toDecide.length === 0 ? (
            <p className="text-theme-text-muted text-sm">Nothing is waiting on a decision.</p>
          ) : (
            <ul className="space-y-3">
              {toDecide.map((r) => (
                <li key={r.id} className="border-theme-surface-border rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-theme-text-primary font-medium">{r.member_name}</p>
                      <p className="text-theme-text-secondary text-sm">
                        {typeLabel(r.leave_type)}: {dates(r)}
                      </p>
                      <p className="text-theme-text-muted text-xs">Asked {formatDate(r.created_at, tz)}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.reason && (
                    <p className="text-theme-text-secondary mt-2 text-sm whitespace-pre-line">
                      <span className="font-medium">Reason: </span>
                      {r.reason}
                    </p>
                  )}
                  <p className="text-theme-text-muted mt-2 text-xs">{tallyLine(r)}</p>
                  <Votes request={r} />
                  {r.can_vote && (
                    <div className="mt-3 space-y-2">
                      <label className="form-label" htmlFor={`note-${r.id}`}>
                        Note to the member (optional)
                      </label>
                      <textarea
                        id={`note-${r.id}`}
                        className="form-input"
                        rows={2}
                        maxLength={1000}
                        value={notes[r.id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busy === r.id}
                          onClick={() => void vote(r, 'approve')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy === r.id}
                          onClick={() => void vote(r, 'deny')}
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  )}
                  {r.my_vote && r.status === LeaveRequestStatus.PENDING && (
                    <p className="text-theme-text-muted mt-2 text-xs">
                      You {r.my_vote === 'approve' ? 'approved' : 'denied'} it; waiting on the other approvers.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {enabled === false && (
        <div className="card mb-6 p-4 text-sm" role="status">
          Your department records leave through its officers rather than taking requests here. Speak to the officer who
          manages leave.
        </div>
      )}

      {enabled && (
        <section className="card mb-6 p-4" aria-labelledby="ask-heading">
          <h2 id="ask-heading" className="text-theme-text-primary mb-3 font-semibold">
            Ask for leave
          </h2>
          <form className="space-y-4" onSubmit={(e) => void submit(e)}>
            <div>
              <label className="form-label" htmlFor="leave-request-type">
                Kind of leave
              </label>
              <select
                id="leave-request-type"
                className="form-input"
                value={form.leave_type}
                onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="form-label" htmlFor="leave-request-start">
                  First day
                </label>
                <input
                  id="leave-request-start"
                  type="date"
                  className="form-input"
                  required
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              {!openEnded && (
                <div>
                  <label className="form-label" htmlFor="leave-request-end">
                    Last day
                  </label>
                  <input
                    id="leave-request-end"
                    type="date"
                    className="form-input"
                    required
                    min={form.start_date || undefined}
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  />
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={openEnded}
                onChange={(e) => setOpenEnded(e.target.checked)}
              />
              I don&rsquo;t know the last day yet
            </label>
            <div>
              <label className="form-label" htmlFor="leave-request-reason">
                Reason (optional)
              </label>
              <textarea
                id="leave-request-reason"
                className="form-input"
                rows={3}
                maxLength={2000}
                aria-describedby="leave-request-reason-help"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
              <p id="leave-request-reason-help" className="text-theme-text-muted mt-1 text-xs">
                Only the approvers read this, after signing in. It is never emailed.
              </p>
            </div>
            <button type="submit" className="btn-primary" disabled={submitting || !form.start_date}>
              {submitting ? 'Sending…' : 'Send request'}
            </button>
          </form>
        </section>
      )}

      <section className="card p-4" aria-labelledby="mine-heading">
        <h2 id="mine-heading" className="text-theme-text-primary mb-3 font-semibold">
          Your requests
        </h2>
        {mine.length === 0 ? (
          <p className="text-theme-text-muted text-sm">You have not asked for leave here.</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((r) => (
              <li key={r.id} className="border-theme-surface-border rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">
                      {typeLabel(r.leave_type)}: {dates(r)}
                    </p>
                    <p className="text-theme-text-muted text-xs">Asked {formatDate(r.created_at, tz)}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-theme-text-muted mt-2 text-xs">{tallyLine(r)}</p>
                <Votes request={r} />
                {r.status === LeaveRequestStatus.PENDING && (
                  <button
                    type="button"
                    className="btn-secondary mt-3"
                    disabled={busy === r.id}
                    onClick={() => void withdraw(r)}
                  >
                    Withdraw
                  </button>
                )}
                {r.status === LeaveRequestStatus.APPROVED && r.end_date && r.end_date < today && (
                  <p className="text-theme-text-muted mt-2 text-xs">This leave has ended.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default LeaveRequestsPage;
