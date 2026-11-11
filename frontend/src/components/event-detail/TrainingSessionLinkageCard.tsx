import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { GraduationCap, Pencil, Lock, Plus, ShieldCheck, Clock } from 'lucide-react';
import type { TrainingApprovalSummary, TrainingSessionResponse } from '../../services/api';
import { trainingSessionService } from '../../services/api';
import { useTrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';
import SessionAttendanceRequirements from './SessionAttendanceRequirements';

interface TrainingSessionLinkageCardProps {
  eventId: string;
  /** What attendance is filed under when the event has no training details. */
  eventTitle: string;
  /** Holder of events.manage: offered the training form, where the details are changed. */
  canManage: boolean;
  /** Holder of training.manage: may see the approval and follow its link. */
  canApprove: boolean;
  /**
   * The event's attendance lock. It, not the session's own flag, decides
   * what may still change: finalizing credits members under the details, so
   * only Counts toward attendance can change until attendance is reopened
   * (the backend refuses anything else with 409), and a session cannot be
   * added.
   */
  attendanceFinalized: boolean;
  /** Bumped by the page after anything that can change the session or its approval. */
  refreshKey?: number | undefined;
  /** Told what session the event has, so the page can describe it consistently. */
  onSessionChange?: ((session: TrainingSessionResponse | null) => void) | undefined;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const linkClass =
  'touch-target-phone text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary focus:ring-theme-focus-ring inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden';

/** A label and its value in the card's summary. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-theme-text-secondary text-sm font-medium">{label}</dt>
    <dd className="text-theme-text-primary text-sm">{children}</dd>
  </div>
);

/**
 * Training details for a Training event, on the event detail page: a
 * read-only summary of the session (owner decision, 2026-11-10).
 *
 * Every Training event credits its attendees when attendance is finalized;
 * the details decide what that credit is filed under (course, type), who
 * taught it, what certification it issues and which requirements it
 * advances. Each is read from the session (pitfall #29), not from the copies
 * the event was created with. They are changed in the training form, which
 * "Edit training details" opens on its Training Info step. After finalizing,
 * the card reports where the sign-off stands, when the session needs one.
 */
const TrainingSessionLinkageCard: React.FC<TrainingSessionLinkageCardProps> = ({
  eventId,
  eventTitle,
  canManage,
  canApprove,
  attendanceFinalized,
  refreshKey = 0,
  onSessionChange,
}) => {
  const [session, setSession] = useState<TrainingSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<TrainingApprovalSummary | null>(null);
  // The last fetch failed for a reason other than "no session" (which the
  // service reports as null). Without this the card would tell an officer the
  // event has no details and offer to add some, which the backend then
  // refuses as a duplicate.
  const [loadFailed, setLoadFailed] = useState(false);
  const tz = useTimezone();

  const { categories, requirements, programs, phases } = useTrainingLinkageData(session?.program_id);

  useEffect(() => {
    let cancelled = false;
    trainingSessionService
      .getSessionByEvent(eventId)
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setLoadFailed(false);
      })
      .catch(() => {
        // Non-critical: the rest of the event page stands on its own. A failed
        // refetch keeps the session already shown rather than blanking it.
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, refreshKey]);

  useEffect(() => {
    if (!loading) onSessionChange?.(session);
  }, [session, loading, onSessionChange]);

  const sessionId = session?.id;
  const wantsSummary = Boolean(sessionId) && attendanceFinalized && (canManage || canApprove);

  // A summary from before a reopen describes an approval that no longer
  // applies; drop it so the next finalize does not flash the old state while
  // its own summary loads.
  if (!wantsSummary && summary !== null) setSummary(null);

  useEffect(() => {
    if (!wantsSummary) return;
    let cancelled = false;
    trainingSessionService
      .getApprovalSummary(eventId)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        // The approval line is a status report; the card is complete without it.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, sessionId, wantsSummary, refreshKey]);

  if (loading) return null;
  if (!session && (loadFailed || (!canManage && !canApprove))) return null;

  const editPath = `/events/${eventId}/edit?step=training`;
  const header = (action: React.ReactNode) => (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5" aria-hidden="true" />
        <h2 className="text-theme-text-primary text-lg font-medium">Training details</h2>
      </div>
      {action}
    </div>
  );

  const cardClass = 'card p-6';

  if (!session) {
    return (
      <div className={cardClass}>
        {header(
          canManage && !attendanceFinalized ? (
            <Link to={editPath} className={linkClass}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add training details
            </Link>
          ) : null
        )}
        {attendanceFinalized ? (
          <>
            <p className="text-theme-text-secondary text-sm">
              No training details: attendance is filed under &lsquo;{eventTitle}&rsquo; as Continuing Education.
            </p>
            <p className="text-theme-text-muted mt-1 text-sm">
              Details can be added after someone who can reopen attendance reopens it.
            </p>
          </>
        ) : (
          <p className="text-theme-text-secondary text-sm">
            No training details: attendance will be credited as &lsquo;{eventTitle}&rsquo;, Continuing Education.
          </p>
        )}
      </div>
    );
  }

  const categoryName = categories.find((c) => c.id === session.category_id)?.name;
  const programName = programs.find((p) => p.id === session.program_id)?.name;
  const requirement = requirements.find((r) => r.id === session.requirement_id);
  const phase = phases.find((p) => p.id === session.phase_id);
  const typeLabel = TRAINING_TYPE_LABELS[session.training_type] ?? session.training_type;

  // A session with no course carries the event's title as its course name;
  // naming it as a course would read as one the department never made.
  const courseLabel =
    !session.course_id && session.course_name === eventTitle
      ? 'No course yet (filed under the event title)'
      : `${session.course_code ? `${session.course_code} - ` : ''}${session.course_name}`;

  const instructorLabel = session.instructor
    ? session.instructor_id
      ? session.instructor
      : `${session.instructor} (${session.course_id ? 'from the course, ' : ''}not a member)`
    : null;

  const certificationLabel = session.issues_certification
    ? [
        session.issuing_agency ? `Issued by ${session.issuing_agency}` : 'Issued',
        session.certification_number_prefix ? `prefix ${session.certification_number_prefix}` : null,
        session.expiration_months ? `expires after ${session.expiration_months} months` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'None';

  // A session-attendance requirement is graded through Counts toward
  // attendance now; one linked here before that stays until someone changes it.
  const requirementLabel = requirement
    ? requirement.requirement_type === 'session_attendance'
      ? `${requirement.name} (currently linked, no longer offered)`
      : requirement.name
    : '—';

  const approvalLine = (() => {
    if (!summary || !wantsSummary) return null;
    if (summary.status === 'approved') {
      return (
        <p className="text-theme-text-secondary flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />
          {summary.approved_at ? `Approved ${formatDate(summary.approved_at, tz)}` : 'Approved'}
        </p>
      );
    }
    if (summary.status === 'pending' && summary.expired) {
      return (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Approval link expired — reopen attendance and finalize again to issue a new one.
        </p>
      );
    }
    if (summary.status === 'pending') {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <Clock className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
            Waiting for sign-off by the instructor or a training officer ({plural(summary.attendee_count, 'member')})
          </p>
          {canApprove && summary.token && (
            <Link to={`/training/approve/${summary.token}`} className="btn-primary px-3 py-1.5 text-sm font-medium">
              Review and approve
            </Link>
          )}
        </div>
      );
    }
    return <p className="text-theme-text-secondary text-sm capitalize">Approval {summary.status}</p>;
  })();

  return (
    <div className={cardClass}>
      {header(
        // Offered after finalizing too: Counts toward attendance can still change.
        canManage ? (
          <Link to={editPath} className={linkClass}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit training details
          </Link>
        ) : null
      )}

      {attendanceFinalized && (
        <div className="border-theme-surface-border bg-theme-surface-hover mb-4 flex items-start gap-3 rounded-lg border p-4">
          <Lock className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p className="text-theme-text-secondary text-sm">
              {canManage
                ? 'Attendance is finalized. Counts toward attendance can still be changed with Edit training details; anything else needs Reopen Attendance first.'
                : 'Attendance is finalized. Use Reopen Attendance on this event to make corrections.'}
            </p>
            {approvalLine}
          </div>
        </div>
      )}

      {session.require_completion_confirmation && (
        <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-300">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Requires sign-off by the instructor or a training officer
        </p>
      )}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row label="Course">{courseLabel}</Row>
        <Row label="Training Type">{typeLabel}</Row>
        {instructorLabel && <Row label="Lead Instructor">{instructorLabel}</Row>}
        {session.credit_hours > 0 && <Row label="Credit Hours">{plural(session.credit_hours, 'hour')}</Row>}
        <Row label="Certification">{certificationLabel}</Row>
        <Row label="Training records">
          {session.auto_create_records
            ? 'Started at check-in, completed when attendance is finalized'
            : 'Completed when attendance is finalized'}
        </Row>
        <Row label="Counts toward certification">{session.counts_toward_certification ? 'Yes' : 'No'}</Row>
        {session.category_id && <Row label="Training category">{categoryName ?? '—'}</Row>}
        {session.requirement_id && <Row label="Requirement">{requirementLabel}</Row>}
        {session.program_id && (
          <Row label="Program">
            {[programName ?? '—', phase ? `Phase ${phase.phase_number}: ${phase.name}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Row>
        )}
      </dl>
      <SessionAttendanceRequirements session={session} requirements={requirements} />
    </div>
  );
};

export default TrainingSessionLinkageCard;
