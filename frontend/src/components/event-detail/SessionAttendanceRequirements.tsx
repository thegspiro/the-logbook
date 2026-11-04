import React, { useState } from 'react';
import { ClipboardCheck, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import type { TrainingSessionResponse } from '../../services/api';
import { trainingSessionService } from '../../services/api';
import type { TrainingRequirement } from '../../types/training';
import { getErrorMessage } from '../../utils/errorHandling';

interface SessionAttendanceRequirementsProps {
  session: TrainingSessionResponse;
  /** Every active requirement; only session-attendance ones are offered. */
  requirements: TrainingRequirement[];
  /** Holder of events.manage: may change which requirements the session counts toward. */
  canManage: boolean;
  onChange: (session: TrainingSessionResponse) => void;
}

/**
 * Which session-attendance requirements a training session counts toward.
 *
 * A linked session is one the members those requirements grade are expected
 * to attend; an unlinked one is optional and counts against nobody. Unlike
 * the training details above it, this may change after attendance is
 * finalized: it alters how the session is graded, not any record it wrote.
 */
const SessionAttendanceRequirements: React.FC<SessionAttendanceRequirementsProps> = ({
  session,
  requirements,
  canManage,
  onChange,
}) => {
  const linked = session.attendance_requirement_ids ?? [];
  const options = requirements.filter((r) => r.requirement_type === 'session_attendance');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(linked);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (options.length === 0 && linked.length === 0) return null;

  const names = linked.map((id) => options.find((r) => r.id === id)?.name ?? 'A requirement no longer active');

  const toggle = (id: string) =>
    setDraft((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await trainingSessionService.setAttendanceRequirements(session.id, draft);
      onChange(updated);
      setEditing(false);
      toast.success('Attendance requirements updated');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update attendance requirements'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-theme-surface-border mt-6 border-t pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-theme-text-primary flex items-center gap-2 text-sm font-medium">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          Counts toward attendance
        </h3>
        {canManage && !editing && options.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft(linked);
              setError(null);
              setEditing(true);
            }}
            className="touch-target-phone text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1.5 text-sm font-medium"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Change
          </button>
        )}
      </div>

      {editing ? (
        <fieldset disabled={saving}>
          <legend className="text-theme-text-muted mb-3 text-sm">
            Members these requirements grade are expected to attend this session. Leave all unticked to make it
            optional.
          </legend>
          {error && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}
          <div className="space-y-2">
            {options.map((r) => (
              <label key={r.id} className="text-theme-text-primary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={draft.includes(r.id)}
                  onChange={() => toggle(r.id)}
                />
                {r.name}
                {r.required_attendance_pct ? (
                  <span className="text-theme-text-muted">({r.required_attendance_pct}%)</span>
                ) : null}
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary touch-target-phone rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              className="btn-primary px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </fieldset>
      ) : linked.length > 0 ? (
        <ul className="text-theme-text-primary list-inside list-disc text-sm">
          {names.map((name, i) => (
            <li key={linked[i] ?? name}>{name}</li>
          ))}
        </ul>
      ) : (
        <p className="text-theme-text-secondary text-sm">Optional: not counted against anyone.</p>
      )}
    </div>
  );
};

export default SessionAttendanceRequirements;
