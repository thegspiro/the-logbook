/**
 * Shared helpers for rendering training-pipeline enrollment progress — used by
 * the officer progress modal (PipelineDetailPage) and the member-facing
 * progression view (MyProgramProgressPage).
 */

import type {
  ProgramPhase,
  ProgramRequirement,
  RequirementProgressRecord,
  RequirementProgressStatus,
} from '../types/training';

/** Label + text colour for each requirement-progress status. */
export const STATUS_META: Record<RequirementProgressStatus, { label: string; className: string }> = {
  not_started: { label: 'Not started', className: 'text-theme-text-muted' },
  in_progress: { label: 'In progress', className: 'text-blue-700 dark:text-blue-400' },
  completed: { label: 'Completed', className: 'text-green-700 dark:text-green-400' },
  verified: { label: 'Verified', className: 'text-green-700 dark:text-green-400' },
  waived: { label: 'Waived', className: 'text-yellow-700 dark:text-yellow-400' },
};

export interface PhaseGroup {
  phase: ProgramPhase | null;
  records: RequirementProgressRecord[];
}

/**
 * Group progress records under their phase, using the program's
 * requirement→phase links. Records not tied to a phase fall into a trailing
 * "Program-level" group. Empty groups are dropped.
 */
export function groupRecordsByPhase(
  records: RequirementProgressRecord[],
  phases: ProgramPhase[],
  programReqs: ProgramRequirement[],
): PhaseGroup[] {
  const reqPhase = new Map<string, string | undefined>();
  programReqs.forEach((pr) => reqPhase.set(pr.requirement_id, pr.phase_id));

  const ordered = [...phases].sort((a, b) => a.phase_number - b.phase_number);
  const groups: PhaseGroup[] = ordered.map((phase) => ({
    phase,
    records: records.filter((r) => reqPhase.get(r.requirement_id) === phase.id),
  }));

  const programLevel = records.filter((r) => {
    const pid = reqPhase.get(r.requirement_id);
    return !pid || !ordered.some((p) => p.id === pid);
  });
  if (programLevel.length > 0) groups.push({ phase: null, records: programLevel });

  return groups.filter((g) => g.records.length > 0);
}

/**
 * A phase group is complete when all of its *required* records are at 100%
 * (records with no matching program-requirement default to required).
 */
export function isPhaseGroupComplete(
  records: RequirementProgressRecord[],
  programReqs: ProgramRequirement[],
): boolean {
  const required = new Map(programReqs.map((pr) => [pr.requirement_id, pr.is_required]));
  return records
    .filter((r) => required.get(r.requirement_id) !== false)
    .every((r) => r.progress_percentage >= 100);
}
