/**
 * Follow-up Forms Section
 *
 * The forms Follow-up Form stages have sent this applicant: where each one
 * stands, what a submission changed on the applicant record, and the
 * contact-change flag a coordinator clears once they have looked at it.
 * Hidden for an applicant who has never reached such a stage.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ClipboardPen, Loader2, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant, FollowUpFormRequest } from '../types';
import { FollowUpFormStatus } from '../types';
import { followUpFormService } from '../services/api';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ApplicantStatus, StageType } from '../../../constants/enums';
import { useApplicantAccess } from './ApplicantAccessContext';
import { FOLLOW_UP_MAX_REMINDERS } from '../constants';

interface FollowUpFormsSectionProps {
  applicant: Applicant;
  tz: string;
}

const STATUS_LABELS: Record<FollowUpFormStatus, string> = {
  not_sent: 'Not sent',
  sent: 'Sent',
  draft: 'Draft saved',
  submitted: 'Submitted',
};

const STATUS_STYLES: Record<FollowUpFormStatus, string> = {
  not_sent: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  sent: 'bg-theme-surface-secondary text-theme-text-secondary',
  draft: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
  submitted: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
};

const OPEN_STATUSES: readonly string[] = [ApplicantStatus.ACTIVE, ApplicantStatus.ON_HOLD];

const FollowUpFormsSection: React.FC<FollowUpFormsSectionProps> = ({ applicant, tz }) => {
  const [requests, setRequests] = useState<FollowUpFormRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // A case manager sends and resends their applicant's forms too.
  const canManage = useApplicantAccess().can_work;

  useEffect(() => {
    if (!applicant.id) return;
    let cancelled = false;
    setLoading(true);
    followUpFormService
      .list(applicant.id)
      .then((rows) => {
        if (!cancelled) setRequests(rows);
      })
      .catch(() => {
        if (!cancelled) setRequests([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicant.id]);

  const replace = (updated: FollowUpFormRequest) =>
    setRequests((prev) => {
      const rest = prev.filter((r) => r.id !== updated.id);
      return [...rest, updated];
    });

  const handleSend = useCallback(
    async (stepId: string, busyKey: string) => {
      setBusyId(busyKey);
      try {
        replace(await followUpFormService.send(applicant.id, stepId));
        toast.success('Form sent to the applicant');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'The form could not be sent'));
      } finally {
        setBusyId(null);
      }
    },
    [applicant.id]
  );

  const handleReviewed = useCallback(
    async (requestId: string) => {
      setBusyId(requestId);
      try {
        replace(await followUpFormService.reviewContactChange(applicant.id, requestId));
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not record the review'));
      } finally {
        setBusyId(null);
      }
    },
    [applicant.id]
  );

  const onFollowUpStage = applicant.current_stage_type === StageType.FOLLOW_UP_FORM;
  const currentStageHasRequest = requests.some((r) => r.step_id === applicant.current_stage_id);
  const applicationOpen = OPEN_STATUSES.includes(applicant.status);

  if (!loading && requests.length === 0 && !onFollowUpStage) return null;

  return (
    <div className="border-theme-surface-border border-b p-4">
      <h3 className="text-theme-text-muted mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase">
        <ClipboardPen className="h-3.5 w-3.5" aria-hidden="true" />
        Follow-up Forms
      </h3>

      {loading ? (
        <div className="flex items-center justify-center py-3" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading follow-up forms</span>
        </div>
      ) : (
        <ul className="space-y-3">
          {onFollowUpStage && !currentStageHasRequest && (
            <li className="card-secondary flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="text-theme-text-primary text-sm font-medium">
                  {applicant.current_stage_name ?? 'Current stage'}
                </p>
                <p className="text-theme-text-muted text-xs">Not sent yet</p>
              </div>
              {canManage && applicationOpen && (
                <button
                  type="button"
                  onClick={() => void handleSend(applicant.current_stage_id, 'current')}
                  disabled={busyId !== null}
                  className="btn-secondary inline-flex items-center gap-1.5 text-xs"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  Send now
                </button>
              )}
            </li>
          )}

          {requests.map((request) => {
            const unreviewed = request.contact_changed && !request.contact_change_reviewed_at;
            return (
              <li key={request.id} className="card-secondary space-y-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-theme-text-primary text-sm font-medium">
                      {request.form_name ?? 'Form no longer available'}
                    </p>
                    {request.step_name && <p className="text-theme-text-muted text-xs">Stage: {request.step_name}</p>}
                  </div>
                  <span className={`badge ${STATUS_STYLES[request.status]}`}>{STATUS_LABELS[request.status]}</span>
                </div>

                <dl className="text-theme-text-muted grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  {request.last_sent_at && (
                    <>
                      <dt>Last sent</dt>
                      <dd>{formatDateTime(request.last_sent_at, tz)}</dd>
                    </>
                  )}
                  {(request.reminder_count ?? 0) > 0 && request.status !== FollowUpFormStatus.SUBMITTED && (
                    <>
                      <dt>Reminders</dt>
                      <dd>
                        {request.reminder_count} of {FOLLOW_UP_MAX_REMINDERS}
                        {request.last_reminder_at ? `, last ${formatDateTime(request.last_reminder_at, tz)}` : ''}
                      </dd>
                    </>
                  )}
                  {request.draft_saved_at && request.status === FollowUpFormStatus.DRAFT && (
                    <>
                      <dt>Draft saved</dt>
                      <dd>{formatDateTime(request.draft_saved_at, tz)}</dd>
                    </>
                  )}
                  {request.submitted_at && (
                    <>
                      <dt>Submitted</dt>
                      <dd>{formatDateTime(request.submitted_at, tz)}</dd>
                    </>
                  )}
                </dl>

                {unreviewed && (
                  <div className="alert-warning flex flex-wrap items-start justify-between gap-2 text-xs" role="status">
                    <p className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Contact details changed. Check the new details before relying on them.
                    </p>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => void handleReviewed(request.id)}
                        disabled={busyId !== null}
                        className="btn-secondary text-xs"
                      >
                        Mark reviewed
                      </button>
                    )}
                  </div>
                )}
                {request.contact_change_reviewed_at && (
                  <p className="text-theme-text-muted text-xs">
                    Contact change reviewed
                    {request.contact_change_reviewed_by_name
                      ? ` by ${request.contact_change_reviewed_by_name}`
                      : ''} on {formatDateTime(request.contact_change_reviewed_at, tz)}
                  </p>
                )}

                {request.changes.length > 0 && (
                  <div>
                    <p className="text-theme-text-secondary mb-1 text-xs font-medium">
                      Changes to the applicant record
                    </p>
                    <ul className="space-y-1 text-xs">
                      {request.changes.map((change) => (
                        <li key={change.field} className="text-theme-text-secondary wrap-break-word">
                          <span className="font-medium">{change.label}:</span> {change.old || '(blank)'} &rarr;{' '}
                          {change.new || '(blank)'}
                          {!change.applied && (
                            <span className="text-theme-text-muted block">
                              Not applied: another open application uses this address.
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {canManage && applicationOpen && request.step_id && request.status !== FollowUpFormStatus.SUBMITTED && (
                  <button
                    type="button"
                    onClick={() => void handleSend(request.step_id ?? '', request.id)}
                    disabled={busyId !== null}
                    className="btn-secondary inline-flex items-center gap-1.5 text-xs"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    {request.status === FollowUpFormStatus.NOT_SENT ? 'Send now' : 'Resend'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default FollowUpFormsSection;
