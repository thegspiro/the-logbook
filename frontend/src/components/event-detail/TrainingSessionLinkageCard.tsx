import React, { useEffect, useState } from 'react';
import { Link2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import type { TrainingSessionResponse, TrainingSessionLinkageUpdate } from '../../services/api';
import { trainingSessionService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { blankToNull } from '../../utils/formValues';
import { TrainingLinkageFields, type TrainingLinkageValue } from '../training/TrainingLinkageFields';
import { useTrainingLinkageData } from '../../hooks/useTrainingLinkageData';

interface TrainingSessionLinkageCardProps {
  eventId: string;
  /** Officers with events.manage may edit; everyone else sees the links read-only. */
  canManage: boolean;
}

const toValue = (session: TrainingSessionResponse): TrainingLinkageValue => ({
  category_id: session.category_id,
  program_id: session.program_id,
  phase_id: session.phase_id,
  requirement_id: session.requirement_id,
});

/**
 * Requirement/program links for an existing training session, on the event
 * detail page.
 *
 * The create wizard sets these when the session is scheduled; this is where
 * they get corrected afterwards — a session created before the requirement
 * existed, or one an officer linked to the wrong pipeline. Renders nothing
 * for events that have no training session (plain events).
 */
const TrainingSessionLinkageCard: React.FC<TrainingSessionLinkageCardProps> = ({ eventId, canManage }) => {
  const [session, setSession] = useState<TrainingSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TrainingLinkageValue>({});

  const linkageData = useTrainingLinkageData(editing ? draft.program_id : session?.program_id);
  const { categories, requirements, programs, phases } = linkageData;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    trainingSessionService
      .getSessionByEvent(eventId)
      .then((data) => {
        if (cancelled) return;
        setSession(data);
      })
      .catch(() => {
        // Non-critical: the rest of the event page stands on its own.
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const handleSave = async () => {
    if (!session) return;
    setSaving(true);
    try {
      // Every field the form owns goes on every save, blanks as explicit null —
      // an omitted key means "leave this alone" to the backend, so a cleared
      // link would silently survive behind a success toast (CLAUDE.md #1).
      const payload: TrainingSessionLinkageUpdate = {
        category_id: blankToNull(draft.category_id),
        program_id: blankToNull(draft.program_id),
        phase_id: blankToNull(draft.phase_id),
        requirement_id: blankToNull(draft.requirement_id),
      };
      const updated = await trainingSessionService.updateSessionLinkage(session.id, payload);
      setSession(updated);
      setEditing(false);
      toast.success('Training links updated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update training links'));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !session) return null;

  const categoryName = categories.find((c) => c.id === session.category_id)?.name;
  const programName = programs.find((p) => p.id === session.program_id)?.name;
  const requirementName = requirements.find((r) => r.id === session.requirement_id)?.name;
  const phase = phases.find((p) => p.id === session.phase_id);
  const hasLinks = Boolean(session.category_id || session.program_id || session.requirement_id);

  return (
    <div className="bg-theme-surface rounded-lg border-l-4 border-red-600 p-6 shadow-sm backdrop-blur-xs">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-6 w-6 text-red-600" />
          <h2 className="text-theme-text-primary text-lg font-medium">Requirements & Programs</h2>
        </div>
        {canManage && !editing && (
          <button
            onClick={() => {
              setDraft(toValue(session));
              setEditing(true);
            }}
            className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary focus:ring-theme-focus-ring inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden"
          >
            <Pencil className="h-4 w-4" />
            {hasLinks ? 'Edit links' : 'Add links'}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <p className="text-theme-text-muted mb-4 text-sm">
            Links steer how future attendance is credited. Members already signed off for this session keep the credit
            they were given.
          </p>
          <TrainingLinkageFields
            data={linkageData}
            value={draft}
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
          />
          <div className="border-theme-surface-border mt-6 flex flex-wrap justify-end gap-3 border-t pt-4">
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary rounded-lg px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="btn-primary px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save links'}
            </button>
          </div>
        </>
      ) : hasLinks ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      ) : (
        <p className="text-theme-text-muted text-sm">
          This session isn&apos;t linked to any requirement or program, so attendance won&apos;t count toward one
          automatically.
          {canManage ? ' Use “Add links” to connect it.' : ''}
        </p>
      )}
    </div>
  );
};

export default TrainingSessionLinkageCard;
