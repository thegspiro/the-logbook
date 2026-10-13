/**
 * The two enrollment rules a program carries — prerequisite programs and
 * whether members may be in other programs at the same time — shared by the
 * create wizard and the edit dialog so both offer the same choices.
 */
import React, { useEffect, useState } from 'react';
import { trainingProgramService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import type { PrerequisiteProgramSummary, TrainingProgram } from '../../types/training';

interface ProgramEnrollmentRulesFieldsProps {
  /** The program being edited, which cannot be its own prerequisite. */
  excludeProgramId?: string | undefined;
  /**
   * Already-selected prerequisites, with names. Keeps a selection visible —
   * and removable — when it is not in the offered list (an archived program).
   */
  knownPrerequisites?: PrerequisiteProgramSummary[] | undefined;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  allowsConcurrent: boolean;
  onAllowsConcurrentChange: (value: boolean) => void;
}

export const ProgramEnrollmentRulesFields: React.FC<ProgramEnrollmentRulesFieldsProps> = ({
  excludeProgramId,
  knownPrerequisites = [],
  selectedIds,
  onSelectedIdsChange,
  allowsConcurrent,
  onAllowsConcurrentChange,
}) => {
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await trainingProgramService.getPrograms();
        if (!cancelled) setPrograms(data);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load the department’s programs'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Templates are left out: nobody is enrolled in a template, so nobody could
  // ever complete one, and requiring it would block every enrollment.
  const offered: PrerequisiteProgramSummary[] = programs
    .filter((p) => p.id !== excludeProgramId && !p.is_template)
    .map((p) => ({ id: p.id, name: p.name }));
  const offeredIds = new Set(offered.map((p) => p.id));
  const options = [
    ...offered,
    ...knownPrerequisites.filter((p) => !offeredIds.has(p.id) && p.id !== excludeProgramId),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (id: string) => {
    onSelectedIdsChange(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
  };

  return (
    <div className="border-theme-surface-border space-y-3 rounded-md border p-3">
      <fieldset>
        <legend className="form-label">Prerequisite programs</legend>
        <p className="text-theme-text-muted mb-2 text-xs">
          Members must complete these programs before they can enroll.
        </p>
        {loading ? (
          <p className="text-theme-text-muted text-sm">Loading programs…</p>
        ) : error ? (
          <p className="text-sm text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : options.length === 0 ? (
          <p className="text-theme-text-muted text-sm">There are no other programs to require yet.</p>
        ) : (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {options.map((p) => (
              <label key={p.id} className="text-theme-text-secondary flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={selectedIds.includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div>
        <label className="text-theme-text-secondary flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={allowsConcurrent}
            onChange={(e) => onAllowsConcurrentChange(e.target.checked)}
          />
          Allow members to be enrolled in other programs at the same time
        </label>
        <p className="text-theme-text-muted text-xs">
          When unchecked, the enroll list flags members who are already in another program. Officers can still enroll
          them.
        </p>
      </div>
    </div>
  );
};

export default ProgramEnrollmentRulesFields;
