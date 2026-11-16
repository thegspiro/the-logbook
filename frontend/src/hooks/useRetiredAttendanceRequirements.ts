import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrainingRequirement } from '../types/training';
import { trainingService } from '../services/api';
import { attendanceRequirements } from '../utils/attendanceRequirements';
import type { TrainingLinkageData } from './useTrainingLinkageData';

/** What a linked requirement is called when even its name cannot be found. */
export const UNNAMED_RETIRED_REQUIREMENT = 'A requirement no longer active';

/**
 * A linked attendance requirement as it is listed: with its percentage while
 * active, "<name> (no longer active)" once retired, and the generic label
 * only when even its name cannot be found. The event page's training card and
 * the training form's Review both name a link through this, so the two
 * screens describe the same link alike.
 */
export const linkedAttendanceLabel = (
  id: string,
  active: readonly TrainingRequirement[],
  retiredNames: Readonly<Record<string, string>>
): string => {
  const requirement = active.find((r) => r.id === id);
  if (requirement) {
    return requirement.required_attendance_pct
      ? `${requirement.name} (${requirement.required_attendance_pct}%)`
      : requirement.name;
  }
  const retired = retiredNames[id];
  return retired && retired !== UNNAMED_RETIRED_REQUIREMENT
    ? `${retired} (no longer active)`
    : UNNAMED_RETIRED_REQUIREMENT;
};

/**
 * The names of linked attendance requirements the form no longer offers,
 * keyed by id: one deactivated since it was linked. The option lists hold
 * active requirements only, yet the link is kept by every save, so the form
 * has to name it to show it. Looked up once, from every requirement, and only
 * once the active list has loaded and something linked is missing from it;
 * a requirement that cannot be found is still listed, under a generic name.
 */
export function useRetiredAttendanceRequirements(
  linkedIds: readonly string[],
  linkageData: TrainingLinkageData
): Record<string, string> {
  const loaded = linkageData.requirementsLoaded ?? true;
  const retiredKey = useMemo(() => {
    if (!loaded) return '';
    const offered = new Set(attendanceRequirements(linkageData.requirements).map((r) => r.id));
    return [...new Set(linkedIds.filter((id) => !offered.has(id)))].sort().join(',');
  }, [loaded, linkedIds, linkageData.requirements]);

  const [everyRequirement, setEveryRequirement] = useState<TrainingRequirement[]>([]);
  const requested = useRef(false);
  useEffect(() => {
    if (!retiredKey || requested.current) return;
    requested.current = true;
    trainingService
      .getRequirements({ active_only: false })
      .then(setEveryRequirement)
      .catch(() => {
        /* non-critical: the link is listed under a generic name */
      });
  }, [retiredKey]);

  return useMemo(() => {
    if (!retiredKey) return {};
    return Object.fromEntries(
      retiredKey
        .split(',')
        .map((id) => [id, everyRequirement.find((r) => r.id === id)?.name ?? UNNAMED_RETIRED_REQUIREMENT])
    );
  }, [retiredKey, everyRequirement]);
}
