/**
 * One attendance waiver request, and the decision on it.
 *
 * The approver's email opens this page, its buttons adding `?action=approve`
 * or `?action=deny`. That only pre-selects the choice. The page NEVER decides
 * on load: mail scanners and link previewers open every link in a message, so
 * a decision taken on arrival would be taken by a scanner. The decision is a
 * POST after the approver presses the button and confirms.
 *
 * What the viewer may do is what the server says (`can_decide`,
 * `can_override`, `can_withdraw`), not something worked out here: the routing
 * depends on positions, the Chief and the fallback chain. The reason is shown
 * only when the server returned it, which it does for the member and for the
 * people who may decide, and for nobody else.
 */

import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { CalendarX } from 'lucide-react';
import { attendanceWaiverService } from '../../services/attendanceWaiverService';
import { TrainingPageHeader } from '../../components/training/TrainingPageHeader';
import { ErrorSummary, FIELD_ERROR_CLASS, FormField } from '../../components/ux';
import { SkeletonCard } from '../../components/ux/Skeleton';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useFieldErrors, type FieldSpecs } from '../../hooks/useFieldErrors';
import { useTimezone } from '../../hooks/useTimezone';
import { ATTENDANCE_WAIVER_STATUS_COLORS, ATTENDANCE_WAIVER_STATUS_LABELS } from '../../constants/enums';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';
import { formatCalendarDate, formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage, toAppError } from '../../utils/errorHandling';
import {
  ATTENDANCE_WAIVER_ACTION_LABELS,
  ATTENDANCE_WAIVER_QUEUE_PATH,
  WAIVER_TEXT_MAX_LENGTH,
} from '../../utils/attendanceWaivers';

type Choice = 'approve' | 'deny';
type DecisionField = 'choice' | 'note';
type OverrideField = 'overrideNote';

const DECISION_FIELDS: FieldSpecs<DecisionField> = {
  choice: { id: 'waiver-decision-approve', label: 'Decision' },
  note: { id: 'waiver-decision-note', label: 'Note to the member' },
};

const OVERRIDE_FIELDS: FieldSpecs<OverrideField> = {
  overrideNote: { id: 'waiver-override-note', label: 'Reason for the override', apiKeys: ['note'] },
};

const choiceFrom = (value: string | null): Choice | null => (value === 'approve' || value === 'deny' ? value : null);

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-theme-text-secondary text-sm font-medium">{label}</dt>
    <dd className="text-theme-text-primary mt-0.5 text-sm break-words whitespace-pre-line">{children}</dd>
  </div>
);

export const AttendanceWaiverDecisionPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const tz = useTimezone();
  const { confirm } = useConfirm();

  const [request, setRequest] = useState<AttendanceWaiverRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [choice, setChoice] = useState<Choice | null>(() => choiceFrom(searchParams.get('action')));
  const [note, setNote] = useState('');
  const [overrideNote, setOverrideNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [decisionFocus, setDecisionFocus] = useState(0);
  const [overrideFocus, setOverrideFocus] = useState(0);
  const decision = useFieldErrors(DECISION_FIELDS);
  const override = useFieldErrors(OVERRIDE_FIELDS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    attendanceWaiverService
      .get(id)
      .then((found) => {
        if (!cancelled) setRequest(found);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          toAppError(err).status === 404
            ? 'This request was not found, or it is not one you can see.'
            : getErrorMessage(err, 'This request could not be loaded.')
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // A refusal can mean the request moved on under us (another approver
  // decided it first); the server's current copy replaces ours.
  const reload = async () => {
    try {
      setRequest(await attendanceWaiverService.get(id));
    } catch {
      // Keep what is on screen; the refusal itself is already shown.
    }
  };

  const handleDecide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;
    const trimmed = note.trim();
    const found: Partial<Record<DecisionField, string>> = {};
    if (!choice) found.choice = 'Choose approve or deny.';
    if (choice === 'deny' && !trimmed) found.note = 'Tell the member why the request is denied.';
    if (Object.keys(found).length > 0) {
      decision.setErrors(found);
      setDecisionFocus((n) => n + 1);
      return;
    }
    decision.clear();
    const approving = choice === 'approve';
    const who = request.member_name ?? 'the member';
    const confirmed = await confirm({
      title: approving ? 'Approve this request?' : 'Deny this request?',
      message: approving
        ? `${who} will be excused from ${request.event_title}, and it will no longer count toward their attendance requirement. The first decision is final.`
        : `${request.event_title} will still count toward ${who}'s attendance requirement, and they cannot ask again for it. The first decision is final.`,
      confirmLabel: approving ? 'Approve' : 'Deny',
      cancelLabel: 'Go back',
      variant: approving ? 'info' : 'danger',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const updated = approving
        ? await attendanceWaiverService.approve(request.id, trimmed || undefined)
        : await attendanceWaiverService.deny(request.id, trimmed);
      setRequest(updated);
      setNote('');
      toast.success(approving ? 'Request approved' : 'Request denied');
    } catch (err: unknown) {
      decision.setFromApiError(err, 'The decision could not be recorded. Try again.');
      setDecisionFocus((n) => n + 1);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;
    const trimmed = overrideNote.trim();
    if (!trimmed) {
      override.setErrors({ overrideNote: 'Give a reason for the override.' });
      setOverrideFocus((n) => n + 1);
      return;
    }
    override.clear();
    const confirmed = await confirm({
      title: 'Override the denial?',
      message: `${request.member_name ?? 'The member'} will be excused from ${request.event_title}. The denial stays on record beside your override, and the waiver counts toward their cap.`,
      confirmLabel: 'Approve on override',
      cancelLabel: 'Go back',
      variant: 'warning',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      setRequest(await attendanceWaiverService.override(request.id, trimmed));
      setOverrideNote('');
      toast.success('Denial overridden; the request is approved');
    } catch (err: unknown) {
      override.setFromApiError(err, 'The override could not be recorded. Try again.');
      setOverrideFocus((n) => n + 1);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!request) return;
    const confirmed = await confirm({
      title: 'Withdraw your request?',
      message: 'The officers will no longer be asked to excuse you. You can ask again before the deadline.',
      confirmLabel: 'Withdraw request',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      setRequest(await attendanceWaiverService.withdraw(request.id));
      toast.success('Request withdrawn');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Your request could not be withdrawn'));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <TrainingPageHeader
      icon={CalendarX}
      title="Attendance waiver request"
      parentCrumbs={[{ label: 'Waiver requests', path: ATTENDANCE_WAIVER_QUEUE_PATH }]}
    />
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {header}
        <div className="mt-6" role="status" aria-live="polite">
          <span className="sr-only">Loading request…</span>
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (loadError || !request) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {header}
        <div className="alert-danger mt-6 rounded-lg p-4 text-sm" role="alert">
          {loadError ?? 'This request could not be loaded.'}
        </div>
        <Link to={ATTENDANCE_WAIVER_QUEUE_PATH} className="btn-secondary mt-4 inline-flex text-sm font-medium">
          All waiver requests
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {header}

      <div className="mt-6 space-y-6">
        <section className="card space-y-4 p-6" aria-labelledby="waiver-request-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="waiver-request-heading" className="text-theme-text-primary text-lg font-semibold">
              {request.member_name ?? 'A member'} asks to be excused
            </h2>
            <span className={`badge border ${ATTENDANCE_WAIVER_STATUS_COLORS[request.status] ?? ''}`}>
              {ATTENDANCE_WAIVER_STATUS_LABELS[request.status] ?? request.status}
              {request.chief_override ? ' (Chief override)' : ''}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Detail label="Session">
              {request.event_id ? (
                <Link to={`/events/${request.event_id}`} className="underline underline-offset-2">
                  {request.event_title}
                </Link>
              ) : (
                request.event_title
              )}
            </Detail>
            <Detail label="Date">
              {formatCalendarDate(request.session_date, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Detail>
            <Detail label="Asked">{formatDateTime(request.submitted_at, tz)}</Detail>
            {request.category && <Detail label="Category">{request.category}</Detail>}
            {request.reason && <Detail label="Reason">{request.reason}</Detail>}
          </dl>
        </section>

        {request.can_decide && (
          <form className="card space-y-4 p-6" onSubmit={(e) => void handleDecide(e)} noValidate>
            <h2 className="text-theme-text-primary text-lg font-semibold">Decide</h2>
            <ErrorSummary
              items={decision.summary}
              formError={decision.formError}
              focusKey={decisionFocus}
              title="Fix these before deciding"
            />
            <fieldset aria-describedby={decision.errors.choice ? 'waiver-decision-choice-error' : undefined}>
              <legend className="form-label">Decision</legend>
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    { value: 'approve', label: 'Approve' },
                    { value: 'deny', label: 'Deny' },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className="border-theme-surface-border hover:bg-theme-surface-hover flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4"
                  >
                    <input
                      type="radio"
                      name="waiver-decision"
                      id={`waiver-decision-${option.value}`}
                      value={option.value}
                      checked={choice === option.value}
                      onChange={() => setChoice(option.value)}
                      disabled={busy}
                    />
                    <span className="text-theme-text-primary text-sm font-medium">{option.label}</span>
                  </label>
                ))}
              </div>
              {decision.errors.choice && (
                <p id="waiver-decision-choice-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                  {decision.errors.choice}
                </p>
              )}
            </fieldset>
            <FormField
              id={DECISION_FIELDS.note.id}
              label={DECISION_FIELDS.note.label}
              required={choice === 'deny'}
              optional={choice !== 'deny'}
              error={decision.errors.note}
              maxLength={WAIVER_TEXT_MAX_LENGTH}
              count={note.length}
              hint="The member sees this note with the decision."
            >
              {(field) => (
                <textarea
                  {...field}
                  className="form-input"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                />
              )}
            </FormField>
            <button type="submit" disabled={busy} className="btn-primary text-sm font-medium disabled:opacity-50">
              {busy ? 'Saving...' : 'Record decision'}
            </button>
          </form>
        )}

        {request.can_override && (
          <form className="card space-y-4 p-6" onSubmit={(e) => void handleOverride(e)} noValidate>
            <div>
              <h2 className="text-theme-text-primary text-lg font-semibold">Chief override</h2>
              <p className="text-theme-text-secondary mt-1 text-sm">
                As Chief you can approve a denied request. The denial stays on record beside the override.
              </p>
            </div>
            <ErrorSummary
              items={override.summary}
              formError={override.formError}
              focusKey={overrideFocus}
              title="Fix this before overriding"
            />
            <FormField
              id={OVERRIDE_FIELDS.overrideNote.id}
              label={OVERRIDE_FIELDS.overrideNote.label}
              required
              error={override.errors.overrideNote}
              maxLength={WAIVER_TEXT_MAX_LENGTH}
              count={overrideNote.length}
            >
              {(field) => (
                <textarea
                  {...field}
                  className="form-input"
                  rows={3}
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  disabled={busy}
                />
              )}
            </FormField>
            <button type="submit" disabled={busy} className="btn-primary text-sm font-medium disabled:opacity-50">
              {busy ? 'Saving...' : 'Approve on override'}
            </button>
          </form>
        )}

        {request.can_withdraw && (
          <div className="card split-row gap-3 p-6 sm:items-center">
            <p className="split-row-main text-theme-text-secondary text-sm">
              Your request is waiting for a decision. You can withdraw it until then.
            </p>
            <button
              type="button"
              onClick={() => void handleWithdraw()}
              disabled={busy}
              className="split-row-aside btn-secondary text-sm font-medium disabled:opacity-50"
            >
              Withdraw request
            </button>
          </div>
        )}

        {request.actions.length > 0 && (
          <section className="card p-6" aria-labelledby="waiver-history-heading">
            <h2 id="waiver-history-heading" className="text-theme-text-primary text-lg font-semibold">
              History
            </h2>
            <ol className="mt-3 space-y-3">
              {request.actions.map((entry) => (
                <li key={entry.id} className="text-sm">
                  <span className="text-theme-text-primary font-medium">
                    {ATTENDANCE_WAIVER_ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                  <span className="text-theme-text-secondary">
                    {entry.actor_name ? ` by ${entry.actor_name}` : ''} · {formatDateTime(entry.created_at, tz)}
                  </span>
                  {entry.note && (
                    <p className="text-theme-text-secondary mt-0.5 break-words whitespace-pre-line">{entry.note}</p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
};

export default AttendanceWaiverDecisionPage;
