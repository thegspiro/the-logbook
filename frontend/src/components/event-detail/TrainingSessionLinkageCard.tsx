import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Link2, Pencil, Lock, Plus, ShieldCheck, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  TrainingApprovalSummary,
  TrainingSessionResponse,
  TrainingSessionLinkageUpdate,
} from '../../services/api';
import { trainingSessionService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { blankToNull } from '../../utils/formValues';
import { useTrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';
import { TrainingDetailsFields } from '../training/TrainingDetailsFields';
import {
  EMPTY_TRAINING_DETAILS,
  hasExplicitTrainingDetails,
  toTrainingDetailsPayload,
  type TrainingDetailsValue,
} from '../training/trainingDetailsValue';

interface TrainingSessionLinkageCardProps {
  eventId: string;
  /** What attendance is filed under when the event has no training details. */
  eventTitle: string;
  /** Officers with events.manage may add or edit details; everyone else sees them read-only. */
  canManage: boolean;
  /** Holder of training.manage: may see the approval and follow its link. */
  canApprove: boolean;
  /**
   * The event's attendance lock. It, not the session's own flag, decides
   * whether details may change: finalizing credits members under them, so a
   * change needs attendance reopened first and is applied by the next
   * finalize (the backend refuses the write with 409 otherwise).
   */
  attendanceFinalized: boolean;
  /** Bumped by the page after anything that can change the session or its approval. */
  refreshKey?: number | undefined;
  /** Told what session the event has, so the page can describe it consistently. */
  onSessionChange?: ((session: TrainingSessionResponse | null) => void) | undefined;
}

const toDetailsValue = (session: TrainingSessionResponse): TrainingDetailsValue => ({
  course_id: session.course_id ?? '',
  category_id: session.category_id ?? '',
  program_id: session.program_id ?? '',
  phase_id: session.phase_id ?? '',
  requirement_id: session.requirement_id ?? '',
  training_type: session.training_type,
});

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const secondaryButtonClass =
  'touch-target-phone text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary focus:ring-theme-focus-ring inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden';

/**
 * Training details for a Training event, on the event detail page.
 *
 * Every Training event credits its attendees when attendance is finalized;
 * the details decide what that credit is filed under (course, type, category)
 * and which program requirement it advances. An event created from Events has
 * none until an officer adds them here. After finalizing, the card reports
 * where the training officer's approval stands, when the session needs one.
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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TrainingDetailsValue>(EMPTY_TRAINING_DETAILS);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  const openEditor = (initial: TrainingDetailsValue) => {
    setDraft(initial);
    setSaveError(null);
    setEditing(true);
  };

  const handleAttach = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const created = await trainingSessionService.attachSession(eventId, toTrainingDetailsPayload(draft));
      setSession(created);
      setEditing(false);
      toast.success('Training details added');
    } catch (err: unknown) {
      // A 409 names its reason — attendance finalized meanwhile, or somebody
      // else added details first — and that reason is what the officer needs.
      setSaveError(getErrorMessage(err, 'Failed to add training details'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Every field the form owns goes on every save, blanks as explicit null —
      // an omitted key means "leave this alone" to the backend, so a cleared
      // link would silently survive behind a success toast (CLAUDE.md #1). The
      // type is the exception: it cannot be cleared, so it is sent only when set.
      const payload: TrainingSessionLinkageUpdate = {
        course_id: blankToNull(draft.course_id),
        category_id: blankToNull(draft.category_id),
        program_id: blankToNull(draft.program_id),
        phase_id: blankToNull(draft.phase_id),
        requirement_id: blankToNull(draft.requirement_id),
      };
      if (draft.training_type) payload.training_type = draft.training_type;
      const updated = await trainingSessionService.updateSessionLinkage(session.id, payload);
      setSession(updated);
      setEditing(false);
      toast.success('Training details updated');
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, 'Failed to update training details'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;
  if (!session && (loadFailed || (!canManage && !canApprove))) return null;

  const showEditor = editing && !attendanceFinalized;

  const editor = (onSave: () => void, saveLabel: string, canSave: boolean) => (
    <>
      <p className="text-theme-text-muted mb-4 text-sm">Changes apply when attendance is next finalized.</p>
      {saveError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
          <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
        </div>
      )}
      <TrainingDetailsFields
        value={draft}
        onChange={setDraft}
        disabled={saving}
        typeRequired={Boolean(session)}
        currentCourseName={session?.course_name}
      />
      <div className="border-theme-surface-border mt-6 flex flex-wrap justify-end gap-3 border-t pt-4">
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary touch-target-phone rounded-lg px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !canSave}
          className="btn-primary px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving...' : saveLabel}
        </button>
      </div>
    </>
  );

  const header = (action: React.ReactNode) => (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-6 w-6 text-red-600" aria-hidden="true" />
        <h2 className="text-theme-text-primary text-lg font-medium">Requirements & Programs</h2>
      </div>
      {action}
    </div>
  );

  const cardClass = 'bg-theme-surface rounded-lg border-l-4 border-red-600 p-6 shadow-sm backdrop-blur-xs';

  if (!session) {
    return (
      <div className={cardClass}>
        {header(
          canManage && !attendanceFinalized && !showEditor ? (
            <button type="button" onClick={() => openEditor(EMPTY_TRAINING_DETAILS)} className={secondaryButtonClass}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add training details
            </button>
          ) : null
        )}
        {showEditor ? (
          editor(() => void handleAttach(), 'Add details', hasExplicitTrainingDetails(draft))
        ) : attendanceFinalized ? (
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
  const requirementName = requirements.find((r) => r.id === session.requirement_id)?.name;
  const phase = phases.find((p) => p.id === session.phase_id);
  const typeLabel = TRAINING_TYPE_LABELS[session.training_type] ?? session.training_type;

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
            Waiting for training officer approval ({plural(summary.attendee_count, 'member')})
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
        canManage && !attendanceFinalized && !showEditor ? (
          <button type="button" onClick={() => openEditor(toDetailsValue(session))} className={secondaryButtonClass}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit details
          </button>
        ) : null
      )}

      {attendanceFinalized && (
        <div className="border-theme-surface-border bg-theme-surface-hover mb-4 flex items-start gap-3 rounded-lg border p-4">
          <Lock className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p className="text-theme-text-secondary text-sm">
              Attendance is finalized. Use Reopen Attendance on this event to make corrections.
            </p>
            {approvalLine}
          </div>
        </div>
      )}

      {showEditor ? (
        editor(() => void handleSave(), 'Save details', true)
      ) : (
        <>
          {session.require_completion_confirmation && (
            <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Requires training officer approval
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-theme-text-secondary text-sm font-medium">Course</p>
              <p className="text-theme-text-primary text-sm">{session.course_name}</p>
            </div>
            <div>
              <p className="text-theme-text-secondary text-sm font-medium">Training Type</p>
              <p className="text-theme-text-primary text-sm">{typeLabel}</p>
            </div>
            {session.credit_hours > 0 && (
              <div>
                <p className="text-theme-text-secondary text-sm font-medium">Credit Hours</p>
                <p className="text-theme-text-primary text-sm">{session.credit_hours} hours</p>
              </div>
            )}
            {session.category_id && (
              <div>
                <p className="text-theme-text-secondary text-sm font-medium">Category</p>
                <p className="text-theme-text-primary text-sm">{categoryName ?? '—'}</p>
              </div>
            )}
            {session.requirement_id && (
              <div>
                <p className="text-theme-text-secondary text-sm font-medium">Requirement</p>
                <p className="text-theme-text-primary text-sm">{requirementName ?? '—'}</p>
              </div>
            )}
            {session.program_id && (
              <div>
                <p className="text-theme-text-secondary text-sm font-medium">Program</p>
                <p className="text-theme-text-primary text-sm">{programName ?? '—'}</p>
              </div>
            )}
            {session.phase_id && (
              <div>
                <p className="text-theme-text-secondary text-sm font-medium">Phase</p>
                <p className="text-theme-text-primary text-sm">
                  {phase ? `Phase ${phase.phase_number}: ${phase.name}` : '—'}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TrainingSessionLinkageCard;
